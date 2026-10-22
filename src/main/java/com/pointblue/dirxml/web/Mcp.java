package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.json.Json;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpContext;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpPrincipal;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The server as an MCP server ({@code docs/agents.md}): JSON-RPC 2.0 over HTTP POST at {@code /mcp}, stateless, the
 * Streamable HTTP transport without a server-sent stream ({@code GET} answers 405, as the specification allows).
 * Every tool call is a call to this server's own API, made in-process with the caller's own headers: the same sign-in,
 * origin check, roles, audit line, per-environment write lock and production gate as the page. Nothing here decides
 * what an agent may do; the API does.
 */
final class Mcp implements HttpHandler {

    static final List<String> PROTOCOLS = List.of("2025-06-18", "2025-03-26", "2024-11-05");
    private static final int MAX_TEXT = 200_000;

    private static final String INSTRUCTIONS = String.join("\n",
        "DirXMLDevWeb: an IDM driver set as code (a git workspace of the branch the person has open) and its Identity Vaults.",
        "Rules, the same as the page's:",
        "1. Orient with session, outline, validate. Edit the tree with run_operations: preview (dryRun, the default) before applying; list_operations names every operation and its arguments.",
        "2. Validate after edits; commit with a message. Never commit secrets.",
        "3. Before any vault write, run plan_deploy and show the person the plan. deploy, rollback and driver_lifecycle need confirm = the environment's name, typed by the person in chat. Never fill it in yourself.",
        "4. Production deploys come from main, pushed and current; the server refuses otherwise. Never work around a refusal: report it.",
        "5. Never print a secret; tools never return one.",
        "This server's resources are the agent kit: the rules (dirxmldev://kit/AGENTS.md), the skills and the docs of this version. The prompt 'setup' installs them.");

    static final String KIT_URI = "dirxmldev://kit/";

    private static final String ORIENT = String.join("\n",
        "Look at this DirXMLDevWeb project and don't change anything:",
        "1. Call session: who you act as, your roles, the project and branch open.",
        "2. Call outline: the driver set and its drivers.",
        "3. Call validate and git_status.",
        "Tell me, in a few lines: who you act as and what you may do, the branch and whether it has uncommitted work, the drivers, and any validation errors.");

    /** The prompt that sets an agent up: the rules, the skills installed, then a look around. Shared with the page's dialog. */
    static String setupPrompt(String skillsDir) {
        return String.join("\n",
            "Set yourself up for DirXMLDevWeb, through the dirxmldev MCP server:",
            "1. Read the resource " + KIT_URI + "AGENTS.md and follow its rules from now on.",
            "2. Install the skills: write each resource under " + KIT_URI + ".claude/skills/ to " + skillsDir + "/<the path after .claude/skills/>, creating folders. Ask me before overwriting a skill that is already there.",
            "3. Read " + KIT_URI + "docs/agent-guide.md and " + KIT_URI + "docs/agents.md.",
            "4. Then orient: call session, outline, validate and git_status, and tell me who you act as and what you may do, the branch, the drivers, and any validation errors.",
            "Don't change the tree or any vault yet.");
    }

    private static String describe(String rel) {
        if (rel.equals("AGENTS.md")) {
            return "The rules for agents on this server, and how to connect: read first";
        }
        if (rel.endsWith("SKILL.md")) {
            return "A skill: " + rel.substring(".claude/skills/".length(), rel.length() - "/SKILL.md".length());
        }
        return null;
    }

    /** This server's MCP address as the caller reaches it. */
    private static String mcpUrl(HttpExchange ex) {
        String host = ex.getRequestHeaders().getFirst("Host");
        String proto = ex.getRequestHeaders().getFirst("X-Forwarded-Proto");
        return (proto == null ? "http" : proto) + "://" + (host == null ? "localhost:8080" : host) + "/mcp";
    }

    private final HttpHandler api;
    private final String version;
    private final List<Tool> tools = new ArrayList<>();

    Mcp(HttpHandler api, String version) {
        this.api = api;
        this.version = version;
        define();
    }

    // ---- the transport ----

    @Override
    public void handle(HttpExchange ex) throws IOException {
        try {
            if (!ex.getRequestMethod().equals("POST")) {
                ex.getResponseHeaders().set("Allow", "POST");
                send(ex, 405, Map.of("error", "POST JSON-RPC to this endpoint; no server-sent stream is offered"));
                return;
            }
            // signed in, from an allowed origin: exactly what the API says about these headers
            Reply who = call(ex, "GET", "/api/session", null);
            if (who.status != 200) {
                send(ex, who.status == 401 || who.status == 403 ? who.status : 401, Json.parse(who.body));
                return;
            }
            Object parsed;
            try {
                parsed = Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            } catch (RuntimeException e) {
                send(ex, 400, error(null, -32700, "not JSON: " + e.getMessage()));
                return;
            }
            if (parsed instanceof List<?> batch) {
                List<Object> out = new ArrayList<>();
                for (Object o : batch) {
                    Object r = message(ex, o);
                    if (r != null) {
                        out.add(r);
                    }
                }
                if (out.isEmpty()) {
                    accepted(ex);
                } else {
                    send(ex, 200, out);
                }
                return;
            }
            Object r = message(ex, parsed);
            if (r == null) {
                accepted(ex);
            } else {
                send(ex, 200, r);
            }
        } finally {
            ex.close();
        }
    }

    /** One JSON-RPC message: a response, or null for a notification. */
    private Object message(HttpExchange ex, Object o) {
        if (!(o instanceof Map<?, ?>)) {
            return error(null, -32600, "a JSON-RPC message is an object");
        }
        Map<String, Object> m = Json.asMap(o);
        Object id = m.get("id");
        String method = Json.asString(m.get("method"));
        if (method == null) {
            return id == null ? null : error(id, -32600, "no method");
        }
        if (id == null) {
            return null;   // notifications/initialized, notifications/cancelled: nothing to answer
        }
        Map<String, Object> params = m.get("params") instanceof Map<?, ?> p ? Json.asMap(p) : Map.of();
        try {
            switch (method) {
                case "initialize": {
                    String asked = Json.asString(params.get("protocolVersion"));
                    Map<String, Object> r = new LinkedHashMap<>();
                    r.put("protocolVersion", asked != null && PROTOCOLS.contains(asked) ? asked : PROTOCOLS.get(0));
                    r.put("capabilities", Map.of("tools", Map.of("listChanged", false), "resources", Map.of("listChanged", false),
                        "prompts", Map.of("listChanged", false)));
                    r.put("serverInfo", Map.of("name", "dirxmldevweb", "version", version));
                    r.put("instructions", INSTRUCTIONS);
                    return result(id, r);
                }
                case "ping":
                    return result(id, Map.of());
                case "resources/list": {
                    // the agent kit: this version's rules, skills and docs (docs/agents.md)
                    List<Object> list = new ArrayList<>();
                    java.nio.file.Path kit = AgentKit.locate();
                    if (kit != null) {
                        for (java.nio.file.Path f : AgentKit.files(kit)) {
                            String rel = kit.relativize(f).toString().replace('\\', '/');
                            Map<String, Object> d = new LinkedHashMap<>();
                            d.put("uri", KIT_URI + rel);
                            d.put("name", rel);
                            d.put("mimeType", rel.endsWith(".md") ? "text/markdown" : "text/plain");
                            if (describe(rel) != null) {
                                d.put("description", describe(rel));
                            }
                            list.add(d);
                        }
                    }
                    return result(id, Map.of("resources", list));
                }
                case "resources/read": {
                    String uri = Json.asString(params.get("uri"));
                    java.nio.file.Path kit = AgentKit.locate();
                    if (uri == null || !uri.startsWith(KIT_URI) || kit == null) {
                        return error(id, -32002, "no resource " + uri);
                    }
                    java.nio.file.Path f = kit.resolve(uri.substring(KIT_URI.length())).normalize();
                    if (!f.startsWith(kit) || !java.nio.file.Files.isRegularFile(f)) {
                        return error(id, -32002, "no resource " + uri);
                    }
                    String text = new String(AgentKit.content(f, version, mcpUrl(ex)), StandardCharsets.UTF_8);
                    return result(id, Map.of("contents", List.of(Map.of("uri", uri, "mimeType", uri.endsWith(".md") ? "text/markdown" : "text/plain", "text", text))));
                }
                case "prompts/list":
                    return result(id, Map.of("prompts", List.of(
                        Map.of("name", "setup", "description", "Set this agent up for DirXMLDevWeb: read the rules, install the skills, then look at the project",
                            "arguments", List.of(Map.of("name", "skills_dir", "description", "where to install the skills (default ~/.claude/skills)", "required", false))),
                        Map.of("name", "orient", "description", "Look at the project: who you act as, the branch, the tree, what validation says"))));
                case "prompts/get": {
                    String name = Json.asString(params.get("name"));
                    Map<String, Object> pargs = params.get("arguments") instanceof Map<?, ?> a ? Json.asMap(a) : Map.of();
                    String text;
                    if ("setup".equals(name)) {
                        String dir = Json.asString(pargs.get("skills_dir"));
                        text = setupPrompt(dir == null || dir.isBlank() ? "~/.claude/skills" : dir);
                    } else if ("orient".equals(name)) {
                        text = ORIENT;
                    } else {
                        return error(id, -32602, "no prompt '" + name + "'");
                    }
                    return result(id, Map.of("description", "DirXMLDevWeb " + name,
                        "messages", List.of(Map.of("role", "user", "content", Map.of("type", "text", "text", text)))));
                }
                case "tools/list": {
                    List<Object> list = new ArrayList<>();
                    for (Tool t : tools) {
                        Map<String, Object> d = new LinkedHashMap<>();
                        d.put("name", t.name);
                        d.put("description", t.description);
                        d.put("inputSchema", t.schema);
                        if (t.writes) {
                            d.put("annotations", Map.of("destructiveHint", true, "readOnlyHint", false));
                        } else {
                            d.put("annotations", Map.of("readOnlyHint", t.readOnly));
                        }
                        list.add(d);
                    }
                    return result(id, Map.of("tools", list));
                }
                case "tools/call": {
                    String name = Json.asString(params.get("name"));
                    Map<String, Object> args = params.get("arguments") instanceof Map<?, ?> a ? Json.asMap(a) : Map.of();
                    for (Tool t : tools) {
                        if (t.name.equals(name)) {
                            return result(id, run(ex, t, args));
                        }
                    }
                    return error(id, -32602, "no tool '" + name + "'");
                }
                default:
                    return error(id, -32601, "method not found: " + method);
            }
        } catch (RuntimeException | IOException e) {
            return error(id, -32603, String.valueOf(e.getMessage()));
        }
    }

    private Map<String, Object> run(HttpExchange ex, Tool t, Map<String, Object> args) throws IOException {
        Map<String, Object> out = new LinkedHashMap<>();
        String missing = t.missing(args);
        Reply r;
        if (missing != null) {
            r = new Reply(400, Json.compact(Map.of("error", missing)));
        } else {
            Request q = t.request.apply(new Args(ex, args));
            r = call(ex, q.method, q.path, q.body);
        }
        String text = r.body;
        if (t.name.equals("session") && r.status == 200) {
            // the page's CSRF token is the page's; an agent signs each call with its bearer token
            Map<String, Object> s = new LinkedHashMap<>(Json.asMap(Json.parse(text)));
            s.remove("csrf");
            text = Json.compact(s);
        }
        if (text.length() > MAX_TEXT) {
            text = text.substring(0, MAX_TEXT) + "\n… cut at " + MAX_TEXT + " characters; narrow the request (a driver, a path)";
        }
        out.put("content", List.of(Map.of("type", "text", "text", text)));
        out.put("isError", r.status >= 400);
        return out;
    }

    // ---- the tools: each a call to the page's own API ----

    private record Request(String method, String path, Object body) {
    }

    /** A tool's arguments, and the exchange they came with (to read the tree's revision first). */
    final class Args {
        final HttpExchange ex;
        final Map<String, Object> m;

        Args(HttpExchange ex, Map<String, Object> m) {
            this.ex = ex;
            this.m = m;
        }

        String s(String k) {
            return Json.asString(m.get(k));
        }

        List<String> list(String k) {
            List<String> out = new ArrayList<>();
            if (m.get(k) instanceof List<?> l) {
                for (Object o : l) {
                    out.add(String.valueOf(o));
                }
            } else if (m.get(k) instanceof String s && !s.isBlank()) {
                out.add(s);
            }
            return out;
        }

        String q(String k) {
            String v = s(k);
            return v == null ? "" : "&" + k + "=" + URLEncoder.encode(v, StandardCharsets.UTF_8);
        }

        /** The tree's current revision, read the way the page reads it. */
        String revision() throws IOException {
            Reply o = call(ex, "GET", "/api/outline", null);
            Object rev = o.status == 200 ? Json.asMap(Json.parse(o.body)).get("revision") : null;
            return rev == null ? null : String.valueOf(rev);
        }
    }

    private static final class Tool {
        final String name;
        final String description;
        final Map<String, Object> schema;
        final boolean readOnly;
        final boolean writes;
        final List<String> required;
        final Fn request;

        Tool(String name, String description, Map<String, Object> props, List<String> required, boolean readOnly, boolean writes, Fn request) {
            this.name = name;
            this.description = description;
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("type", "object");
            s.put("properties", props);
            if (!required.isEmpty()) {
                s.put("required", required);
            }
            this.schema = s;
            this.required = required;
            this.readOnly = readOnly;
            this.writes = writes;
            this.request = request;
        }

        String missing(Map<String, Object> args) {
            for (String k : required) {
                Object v = args.get(k);
                if (v == null || (v instanceof String str && str.isBlank())) {
                    return "'" + k + "' is required";
                }
            }
            return null;
        }
    }

    @FunctionalInterface
    private interface Fn {
        Request apply(Args a) throws IOException;
    }

    private static Map<String, Object> str(String description) {
        return Map.of("type", "string", "description", description);
    }

    private static Map<String, Object> strs(String description) {
        return Map.of("type", "array", "items", Map.of("type", "string"), "description", description);
    }

    private static Map<String, Object> bool(String description) {
        return Map.of("type", "boolean", "description", description);
    }

    private static Map<String, Object> props(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    private void tool(String name, String description, Map<String, Object> props, List<String> required, boolean writes, Fn request) {
        tools.add(new Tool(name, description, props, required, !writes, writes, request));
    }

    private void edit(String name, String description, Map<String, Object> props, List<String> required, Fn request) {
        tools.add(new Tool(name, description, props, required, false, false, request));
    }

    private void define() {
        // orientation
        tool("session", "Who you are acting as, your roles, the project and branch open, and the server's and core's versions.",
            props(), List.of(), false, a -> new Request("GET", "/api/session", null));
        tool("outline", "The tree: the driver set, its drivers and every policy, resource and object, with the tree's revision.",
            props(), List.of(), false, a -> new Request("GET", "/api/outline", null));
        tool("read_artifact", "One artifact's content and details, by its tree path (e.g. drivers/AD/subscriber/sub-ctp, library/NOVLLIBAJC-JS).",
            props("path", str("the artifact's tree path, as outline lists it")), List.of("path"), false,
            a -> new Request("GET", "/api/artifact?" + a.q("path").substring(1), null));
        tool("read_file", "A file of the tree, by its path relative to the tree (e.g. drivers/AD/driver.xml, overrides/QA.properties).",
            props("file", str("the file's path in the tree")), List.of("file"), false,
            a -> new Request("GET", "/api/file?" + a.q("file").substring(1), null));
        tool("validate", "The engine's own checks over the whole tree: compile, linkage, GCVs, mapping tables, filter and schema map. Errors block a deploy.",
            props(), List.of(), false, a -> new Request("GET", "/api/validate", null));
        tool("fishbone", "A driver's policy flow: every policy set in order, with what each holds.",
            props("driver", str("the driver's name")), List.of("driver"), false, a -> new Request("GET", "/api/fishbone?" + a.q("driver").substring(1), null));
        tool("git_status", "The workspace's branch, uncommitted files, commits not pushed, and where it stands against the base branch.",
            props(), List.of(), false, a -> new Request("GET", "/api/git/status", null));
        tool("git_diff", "What differs from the last commit (against=head, the default) or from the base branch (against=base).",
            props("against", str("head (default) or base")), List.of(), false,
            a -> new Request("GET", "/api/git/diff?against=" + (a.s("against") == null ? "head" : URLEncoder.encode(a.s("against"), StandardCharsets.UTF_8)), null));

        // editing the tree
        tool("list_operations", "Every edit operation the tree takes (policy.add, gcv.set, driver.set, override.set, environments.set, …) with its arguments.",
            props(), List.of(), false, a -> new Request("GET", "/api/catalog", null));
        edit("run_operations",
            "Edit the tree with one or more operations, applied together or not at all. dryRun (the default) previews what would change and writes nothing; "
                + "run again with dryRun false to apply. Validate afterwards. File arguments take the content inline.",
            props("operations", Map.of("type", "array", "description", "[{name, args: {…}, files: {argName: content}}], names and args as list_operations gives them",
                    "items", Map.of("type", "object")),
                "dryRun", bool("preview only (default true)")),
            List.of("operations"),
            a -> {
                List<Object> ops = new ArrayList<>();
                if (a.m.get("operations") instanceof List<?> l) {
                    for (Object o : l) {
                        Map<String, Object> op = Json.asMap(o);
                        Map<String, Object> one = new LinkedHashMap<>();
                        one.put("name", op.get("name"));
                        one.put("args", op.get("args") == null ? Map.of() : op.get("args"));
                        one.put("files", op.get("files") == null ? Map.of() : op.get("files"));
                        ops.add(one);
                    }
                }
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("ops", ops);
                body.put("dryRun", !Boolean.FALSE.equals(a.m.get("dryRun")));
                body.put("revision", a.revision());
                return new Request("POST", "/api/batch", body);
            });
        edit("commit", "Commit the workspace's changes with a message, and push them when push is true.",
            props("message", str("the commit message"), "push", bool("push to the repository too")), List.of("message"),
            a -> new Request("POST", "/api/git/commit", Map.of("message", a.s("message"), "push", Boolean.TRUE.equals(a.m.get("push")))));

        // the vaults: reads
        tool("environments", "The environments this project deploys to, with tier (dev, test, prd) and whether you are connected to each.",
            props(), List.of(), false, a -> new Request("GET", "/api/vault/environments", null));
        tool("compare", "The tree against an environment's vault: every difference a deploy would write. Nothing is written.",
            props("env", str("environment name"), "drivers", strs("only these drivers (the tree's names); all when omitted")), List.of("env"), false,
            a -> new Request("GET", "/api/vault/diff?" + a.q("env").substring(1) + drivers(a), null));
        tool("compare_environments", "Two environments' vaults side by side: drivers and objects only one holds, values that differ, likely renames, and the rest with a likely cause. Nothing is written.",
            props("env", str("one environment"), "with", str("the other")), List.of("env", "with"), false,
            a -> new Request("GET", "/api/vault/compare-envs?" + a.q("env").substring(1) + a.q("with"), null));
        tool("plan_deploy", "What a deploy to an environment would do, step by step, and what stands in its way (validation, production's rules). Nothing is written. Show this to the person before deploy.",
            props("env", str("environment name"), "drivers", strs("only these drivers; the whole driver set when omitted"),
                "restart", bool("restart drivers a change needs restarted (default true)"),
                "secrets", str("none (default), missing, or all")),
            List.of("env"), false, a -> new Request("POST", "/api/vault/plan", vaultBody(a)));
        tool("driver_status", "The drivers' state in an environment (running, stopped), or one driver's.",
            props("env", str("environment name"), "driver", str("one driver (optional)")), List.of("env"), false,
            a -> new Request("GET", "/api/vault/driver-status?" + a.q("env").substring(1) + a.q("driver"), null));
        tool("trace", "A driver's recent trace in an environment.",
            props("env", str("environment name"), "driver", str("the driver")), List.of("env", "driver"), false,
            a -> new Request("GET", "/api/vault/trace-show?" + a.q("env").substring(1) + a.q("driver"), null));
        tool("snapshots", "The snapshots earlier deploys took in an environment (what a rollback puts back).",
            props("env", str("environment name")), List.of("env"), false, a -> new Request("GET", "/api/vault/snapshots?" + a.q("env").substring(1), null));

        // the simulator
        tool("simulate", "Run the project's simulator cases (cases/) against the tree, optionally with an environment's values.",
            props("env", str("apply this environment's overrides (optional)")), List.of(), false,
            a -> new Request("POST", "/api/sim/run", a.s("env") == null ? Map.of() : Map.of("env", a.s("env"))));

        // the vaults: writes, gated by the server (role, confirm, production's rules, one write per environment at a time)
        tool("deploy", "Deploy the tree to an environment. Only after plan_deploy has been shown to the person and they typed the environment's name in chat as confirm. The server refuses otherwise.",
            props("env", str("environment name"), "drivers", strs("only these drivers; the whole driver set when omitted"),
                "confirm", str("the environment's name, typed by the person"), "restart", bool("restart drivers a change needs restarted (default true)"),
                "secrets", str("none (default), missing, or all")),
            List.of("env", "confirm"), true, a -> {
                Map<String, Object> b = vaultBody(a);
                b.put("confirm", a.s("confirm"));
                return new Request("POST", "/api/vault/deploy", b);
            });
        tool("rollback", "Put back the snapshot a deploy took. Only when the person asks, with the environment's name typed by them as confirm.",
            props("env", str("environment name"), "snapshot", str("the snapshot, as snapshots lists it"), "confirm", str("the environment's name, typed by the person")),
            List.of("env", "snapshot", "confirm"), true,
            a -> new Request("POST", "/api/vault/rollback", Map.of("env", a.s("env"), "snapshot", a.s("snapshot"), "confirm", a.s("confirm"))));
        tool("driver_lifecycle", "Start, stop or restart a driver in an environment. Only when the person asks, with the environment's name typed by them as confirm.",
            props("env", str("environment name"), "driver", str("the driver"), "action", str("start, stop or restart"), "confirm", str("the environment's name, typed by the person")),
            List.of("env", "driver", "action", "confirm"), true,
            a -> new Request("POST", "/api/vault/driver", Map.of("env", a.s("env"), "driver", a.s("driver"), "action", a.s("action"), "confirm", a.s("confirm"))));
    }

    private static String drivers(Args a) {
        StringBuilder sb = new StringBuilder();
        for (String d : a.list("drivers")) {
            sb.append("&driver=").append(URLEncoder.encode(d, StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    private static Map<String, Object> vaultBody(Args a) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("env", a.s("env"));
        b.put("drivers", a.list("drivers"));
        b.put("restart", !Boolean.FALSE.equals(a.m.get("restart")));
        b.put("secrets", a.s("secrets") == null ? "none" : a.s("secrets"));
        return b;
    }

    // ---- an in-process call to the API, with the caller's headers ----

    private record Reply(int status, String body) {
    }

    private Reply call(HttpExchange from, String method, String pathAndQuery, Object body) throws IOException {
        String uri = pathAndQuery;
        // local mode's session token may come as ?token= on the MCP URL
        String raw = from.getRequestURI().getRawQuery();
        if (raw != null) {
            for (String part : raw.split("&")) {
                if (part.startsWith("token=")) {
                    uri += (uri.contains("?") ? "&" : "?") + part;
                }
            }
        }
        Local ex = new Local(from, method, URI.create(uri), body == null ? new byte[0] : Json.compact(body).getBytes(StandardCharsets.UTF_8));
        for (String h : List.of("Host", "Origin", "Authorization", Security.HEADER, "Cookie", "X-Forwarded-For", "X-Forwarded-Proto")) {
            String v = from.getRequestHeaders().getFirst(h);
            if (v != null) {
                ex.requestHeaders.set(h, v);
            }
        }
        api.handle(ex);
        return new Reply(ex.status, ex.out.toString(StandardCharsets.UTF_8));
    }

    /** A request made inside the server: the caller's identity, a path of the API, the reply kept in memory. */
    private static final class Local extends HttpExchange {
        final HttpExchange from;
        final String method;
        final URI uri;
        final Headers requestHeaders = new Headers();
        final Headers responseHeaders = new Headers();
        final InputStream in;
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        int status = 500;

        Local(HttpExchange from, String method, URI uri, byte[] body) {
            this.from = from;
            this.method = method;
            this.uri = uri;
            this.in = new ByteArrayInputStream(body);
            if (body.length > 0) {
                requestHeaders.set("Content-Type", "application/json");
            }
        }

        @Override public Headers getRequestHeaders() { return requestHeaders; }
        @Override public Headers getResponseHeaders() { return responseHeaders; }
        @Override public URI getRequestURI() { return uri; }
        @Override public String getRequestMethod() { return method; }
        @Override public HttpContext getHttpContext() { return from.getHttpContext(); }
        @Override public void close() { }
        @Override public InputStream getRequestBody() { return in; }
        @Override public OutputStream getResponseBody() { return out; }
        @Override public void sendResponseHeaders(int rCode, long responseLength) { status = rCode; }
        @Override public InetSocketAddress getRemoteAddress() { return from.getRemoteAddress(); }
        @Override public int getResponseCode() { return status; }
        @Override public InetSocketAddress getLocalAddress() { return from.getLocalAddress(); }
        @Override public String getProtocol() { return from.getProtocol(); }
        @Override public Object getAttribute(String name) { return from.getAttribute(name); }
        @Override public void setAttribute(String name, Object value) { from.setAttribute(name, value); }
        @Override public void setStreams(InputStream i, OutputStream o) { }
        @Override public HttpPrincipal getPrincipal() { return from.getPrincipal(); }
    }

    // ---- JSON-RPC ----

    private static Map<String, Object> result(Object id, Object result) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jsonrpc", "2.0");
        m.put("id", id);
        m.put("result", result);
        return m;
    }

    private static Map<String, Object> error(Object id, int code, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jsonrpc", "2.0");
        m.put("id", id);
        m.put("error", Map.of("code", code, "message", message));
        return m;
    }

    private static void accepted(HttpExchange ex) throws IOException {
        ex.sendResponseHeaders(202, -1);
    }

    private static void send(HttpExchange ex, int status, Object body) throws IOException {
        byte[] bytes = Json.compact(body).getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream o = ex.getResponseBody()) {
            o.write(bytes);
        }
    }

    /** For tests and the agent kit: the tools' names, in order. */
    List<String> toolNames() {
        List<String> out = new ArrayList<>();
        for (Tool t : tools) {
            out.add(t.name);
        }
        return out;
    }
}
