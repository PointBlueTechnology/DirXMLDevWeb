package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.json.Json;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * The HTTP face of a workspace's services. Reads are GETs; a write is {@code POST /api/op/<name>}
 * with the operation's arguments, exactly the CLI's, and {@code dryRun} to preview. Every request
 * passes {@link Security} first, then resolves its {@link Session} (the token in local mode, the
 * cookie in hosted mode) and the session's open {@link Workspace}. {@code /api/events} is a
 * server-sent stream of tree revisions.
 */
public final class Api implements HttpHandler {

    public static final String COOKIE = "idmweb_session";
    public static final String CSRF_HEADER = "X-IDMWeb-CSRF";
    /** POST routes only a deployer may call: they reach a vault or hold its credentials. */
    private static final java.util.List<String> DEPLOYER_ONLY = java.util.List.of("/api/vault/deploy", "/api/vault/driver", "/api/vault/trace-level", "/api/vault/deploy-schema", "/api/credentials/environment", "/api/credentials/environment/remove", "/api/credentials/secret");

    private final Workspaces workspaces;
    private final Session.Store sessions;
    private final Security security;
    private final Audit audit;
    private final String version;
    private final Map<String, Session.Principal> agents;
    private final Map<String, String> agentSessions = new java.util.concurrent.ConcurrentHashMap<>();
    private SetupService setup;              // hosted mode only
    private CredentialService setupCredentials;   // the connections before a workspace exists

    /** Hosted mode: the first-run setup, and the connections view before any workspace is open. */
    public Api withSetup(SetupService setup, CredentialService credentials) {
        this.setup = setup;
        this.setupCredentials = credentials;
        return this;
    }

    public Api(Workspaces workspaces, Session.Store sessions, Security security, Audit audit, String version) {
        this(workspaces, sessions, security, audit, version, Map.of());
    }

    public Api(Workspaces workspaces, Session.Store sessions, Security security, Audit audit, String version, Map<String, Session.Principal> agents) {
        this.workspaces = workspaces;
        this.sessions = sessions;
        this.security = security;
        this.audit = audit;
        this.version = version;
        this.agents = agents;
    }

    /** An agent's session for its bearer token, made on first use and kept while the server runs. */
    private Session agentSession(String token) {
        for (Map.Entry<String, Session.Principal> e : agents.entrySet()) {
            if (java.security.MessageDigest.isEqual(e.getKey().getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8))) {
                String id = agentSessions.get(e.getKey());
                Session s = id == null ? null : sessions.get(id);
                if (s == null) {
                    s = sessions.create(e.getValue());
                    s.bearer = true;
                    agentSessions.put(e.getKey(), s.id);
                    audit.log(s, null, "sign-in", Map.of("provider", "bearer"), "ok");
                }
                return s;
            }
        }
        return null;
    }

    /**
     * A session with no workspace yet — or one whose workspace this server has not opened (a restart:
     * the session came from the file, the clone is still on disk) — gets the person's last project
     * and branch back, once. If that is gone, the page asks, as on a first visit.
     */
    private Session restored(Session s) {
        if (s == null || s.restoreTried || (s.workspace != null && workspaces.get(s.workspace) != null)) {
            return s;
        }
        s.restoreTried = true;
        Session.Last last = sessions.lastOf(s.principal.subject);
        if (last == null) {
            s.workspace = null;
            return s;
        }
        try {
            Workspace w = workspaces.openBranch(s.principal, last.project, last.branch);
            sessions.opened(s, w.id, last.project, last.branch);
        } catch (IOException | RuntimeException e) {
            s.workspace = null;
        }
        return s;
    }

    static String cookie(HttpExchange ex, String name) {
        for (String header : ex.getRequestHeaders().getOrDefault("Cookie", java.util.List.of())) {
            for (String part : header.split(";")) {
                String t = part.trim();
                if (t.startsWith(name + "=")) {
                    return t.substring(name.length() + 1);
                }
            }
        }
        return null;
    }

    /** The session a request belongs to, or null. */
    private Session session(HttpExchange ex, Map<String, String> query) {
        if (security.hostedMode()) {
            String auth = ex.getRequestHeaders().getFirst("Authorization");
            if (auth != null && auth.regionMatches(true, 0, "Bearer ", 0, 7)) {
                return restored(agentSession(auth.substring(7).trim()));
            }
            return restored(sessions.get(cookie(ex, COOKIE)));
        }
        String presented = ex.getRequestHeaders().getFirst(Security.HEADER);
        if (presented == null) {
            presented = query.get("token");
        }
        return sessions.get(presented);
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        Workspace w = null;
        try {
            Map<String, String> query = query(ex.getRequestURI().getRawQuery());
            String presented = ex.getRequestHeaders().getFirst(Security.HEADER);
            if (presented == null) {
                presented = query.get("token");
            }
            String refusal = security.refuse(ex.getRequestHeaders().getFirst("Host"), ex.getRequestHeaders().getFirst("Origin"), presented);
            if (refusal != null) {
                send(ex, 403, error(refusal));
                return;
            }
            Session session = session(ex, query);
            if (session == null) {
                Map<String, Object> m = error(security.hostedMode() ? "sign in first" : "missing or wrong session token");
                if (security.hostedMode()) {
                    m.put("login", "/auth/login");
                }
                send(ex, 401, m);
                return;
            }
            String path = ex.getRequestURI().getPath();
            String method = ex.getRequestMethod();
            if (security.hostedMode() && !method.equals("GET") && !session.bearer) {
                String csrf = ex.getRequestHeaders().getFirst(CSRF_HEADER);
                if (csrf == null || !java.security.MessageDigest.isEqual(csrf.getBytes(StandardCharsets.UTF_8), session.csrf.getBytes(StandardCharsets.UTF_8))) {
                    send(ex, 403, error("missing or wrong CSRF token"));
                    return;
                }
            }
            if (!method.equals("GET") && !session.principal.editor) {
                send(ex, 403, error("your account may read but not change anything"));
                return;
            }
            // trace is for every signed-in user; driver control and the trace level stay with deployers
            if (!session.principal.deployer && DEPLOYER_ONLY.contains(path)) {
                send(ex, 403, error("this needs the deployer role"));
                return;
            }
            if (path.equals("/api/audit")) {
                // the server's audit log: hosted mode, deployers only (#42)
                if (!security.hostedMode()) {
                    throw new TreeService.NotFound("no audit log in local mode");
                }
                if (!session.principal.deployer) {
                    throw new Forbidden("the audit log needs the deployer role");
                }
                int limit = query.get("limit") == null ? 200 : Integer.parseInt(query.get("limit"));
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("entries", audit.read(query.get("since"), query.get("user"), query.get("project"), query.get("event"), Math.min(limit, 2000)));
                send(ex, 200, m);
                return;
            }
            if (path.equals("/api/session") || path.startsWith("/api/workspaces")) {
                send(ex, 200, path.equals("/api/session") ? sessionInfo(session) : workspaceRoute(session, method, path, query, ex));
                return;
            }
            if (path.startsWith("/api/setup") && setup != null) {
                send(ex, 200, setupRoute(session, method, path, query, ex));
                return;
            }
            w = workspaces.get(session.workspace);
            if (w == null && path.startsWith("/api/credentials") && setupCredentials != null) {
                // the connections are the server's, not a workspace's: reachable before one is open
                send(ex, 200, credentialsRoute(setupCredentials, session, method, path, query, ex));
                return;
            }
            if (w == null) {
                Map<String, Object> m = error("no workspace is open; open a branch first");
                m.put("noWorkspace", true);
                send(ex, 409, m);
                return;
            }
            if (path.equals("/api/events") && method.equals("GET")) {
                events(ex, w);
                return;
            }
            if (path.equals("/api/vault/trace") && method.equals("GET")) {
                audit.log(session, w, "trace", Map.of("env", String.valueOf(query.get("env")), "driver", String.valueOf(query.get("driver")), "server", String.valueOf(query.get("server"))), "started");
                trace(ex, w, query);
                return;
            }
            Object body = route(session, w, method, path, query, ex);
            if (!method.equals("GET") && !path.startsWith("/api/git/") && !path.startsWith("/api/sim/detail")) {
                audit.log(session, w, path.substring("/api/".length()), summary(body), outcome(body));
            }
            send(ex, 200, body);
        } catch (TreeService.NotFound e) {
            send(ex, 404, error(e.getMessage()));
        } catch (Forbidden e) {
            send(ex, 403, error(e.getMessage()));
        } catch (TreeService.BadRequest e) {
            send(ex, 400, error(e.getMessage()));
        } catch (TreeService.Stale e) {
            Map<String, Object> m = error(e.getMessage());
            m.put("revision", w == null ? null : w.watcher.revision());
            send(ex, 409, m);
        } catch (Exception e) {
            send(ex, 500, error(e.getClass().getSimpleName() + ": " + e.getMessage()));
        }
    }

    private Map<String, Object> sessionInfo(Session session) {
        Workspace w = workspaces.get(session.workspace);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", "DirXMLDevWeb");
        m.put("version", version);
        m.put("core", coreVersion());
        m.put("mode", security.hostedMode() ? "hosted" : "local");
        m.put("csrf", session.csrf);
        Map<String, Object> u = new LinkedHashMap<>();
        u.put("subject", session.principal.subject);
        u.put("name", session.principal.name);
        u.put("email", session.principal.email);
        u.put("editor", session.principal.editor);
        u.put("deployer", session.principal.deployer);
        m.put("user", u);
        m.put("setup", workspaces.needsSetup());
        Project p = w == null ? null : workspaces.projectOf(w);
        m.put("project", p == null ? null : p.name);
        m.put("workspace", w == null ? null : w.id);
        m.put("branch", w == null ? null : w.branch);
        m.put("tree", w == null ? null : w.tree.toString());
        m.put("revision", w == null ? null : w.watcher.revision());
        return m;
    }

    private Object workspaceRoute(Session session, String method, String path, Map<String, String> query, HttpExchange ex) throws IOException {
        if (method.equals("GET") && path.equals("/api/workspaces")) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("mode", security.hostedMode() ? "hosted" : "local");
            m.put("setup", workspaces.needsSetup());
            m.put("open", workspaces.describe(session.principal));
            m.put("current", session.workspace);
            if (workspaces.hosted()) {
                m.put("projects", workspaces.projects());
                Workspace cur = workspaces.get(session.workspace);
                Project p = cur != null ? workspaces.projectOf(cur) : null;
                String which = query.get("project") != null ? query.get("project") : p != null ? p.name : workspaces.needsSetup() ? null : workspaces.config().projects.keySet().iterator().next();
                if (which != null) {
                    Project chosen = workspaces.project(which);
                    m.put("project", chosen.name);
                    m.put("repository", chosen.shownUrl());
                    m.put("inPlace", chosen.inPlace != null);
                    m.put("base", chosen.base);
                    m.put("branches", workspaces.branches(which));
                }
            }
            return m;
        }
        if (method.equals("POST") && path.equals("/api/workspaces/open")) {
            if (!workspaces.hosted()) {
                throw new TreeService.BadRequest("local mode has one workspace, the tree on the command line");
            }
            Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            String branch = Json.asString(req.get("branch"));
            Workspace w = workspaces.openBranch(session.principal, Json.asString(req.get("project")), branch);
            Project opened = workspaces.projectOf(w);
            sessions.opened(session, w.id, opened == null ? null : opened.name, w.id.endsWith("/in-place") ? null : branch);
            Project p = workspaces.projectOf(w);
            audit.log(session, w, "workspace.open", Map.of("project", p == null ? "" : p.name, "branch", String.valueOf(branch)), "ok");
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("workspace", w.id);
            m.put("project", p == null ? null : p.name);
            m.put("branch", w.branch);
            return m;
        }
        throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
    }

    private Object route(Session session, Workspace w, String method, String path, Map<String, String> query, HttpExchange ex) throws IOException {
        TreeService service = w.service;
        VaultService vault = w.vault;
        SimService sim = w.sim;
        ProvisioningService prov = w.prov;
        PackageService packages = w.packages;
        CredentialService credentials = w.credentials;
        if (path.startsWith("/api/git/")) {
            return gitRoute(session, w, method, path, query, ex);
        }
        if (path.startsWith("/api/credentials")) {
            return credentialsRoute(credentials, session, method, path, query, ex);
        }
        if (method.equals("GET")) {
            switch (path) {
                case "/api/outline":
                    return service.outline();
                case "/api/artifact":
                    return service.artifact(required(query, "path"));
                case "/api/file":
                    return service.file(required(query, "file"));
                case "/api/fishbone":
                    return service.fishbone(required(query, "driver"));
                case "/api/validate":
                    return service.validation();
                case "/api/config":
                    return service.config(query.get("driver"));
                case "/api/overrides":
                    return service.overrides();
                case "/api/prd":
                    return prov.prd(required(query, "driver"), required(query, "name"));
                case "/api/form":
                    return prov.form(required(query, "driver"), required(query, "name"));
                case "/api/roles":
                    return prov.catalog();
                case "/api/packages":
                    return packages.overview();
                case "/api/packages/sites":
                    return packages.sites();
                case "/api/packages/prompts":
                    return packages.prompts(required(query, "packages"), query.get("driver"));
                case "/api/packages/site":
                    return packages.site(required(query, "site"));
                case "/api/sim/cases":
                    return sim.list();
                case "/api/sim/case":
                    return sim.files(required(query, "name"));
                case "/api/vault/environments":
                    return vault.environments();
                case "/api/vault/diff":
                    return vault.diff(required(query, "env"), list(query.get("driver")));
                case "/api/vault/status":
                    return vault.status(required(query, "env"));
                case "/api/vault/servers":
                    return vault.servers(required(query, "env"));
                case "/api/schema":
                    return vault.schema();
                case "/api/schema/class":
                    return vault.schemaClass(required(query, "name"));
                case "/api/schema/app":
                    return vault.appSchema(required(query, "driver"));
                case "/api/catalog": {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("operations", TreeService.catalog());
                    return m;
                }
                default:
                    throw new TreeService.NotFound("no such endpoint: GET " + path);
            }
        }
        if (method.equals("POST") && (path.startsWith("/api/op/") || path.equals("/api/batch"))) {
            Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            java.util.List<TreeService.Call> calls = new java.util.ArrayList<>();
            if (path.equals("/api/batch")) {
                Object ops = req.get("ops");
                if (ops instanceof java.util.List) {
                    for (Object o : (java.util.List<?>) ops) {
                        Map<String, Object> om = Json.asMap(o);
                        calls.add(new TreeService.Call(Json.asString(om.get("name")), strings(om.get("args")), strings(om.get("files"))));
                    }
                }
            } else {
                calls.add(new TreeService.Call(path.substring("/api/op/".length()), strings(req.get("args")), strings(req.get("files"))));
            }
            return service.run(calls, Boolean.TRUE.equals(req.get("dryRun")), Boolean.TRUE.equals(req.get("force")), Json.asString(req.get("revision")));
        }
        if (method.equals("POST") && path.equals("/api/packages/build")) {
            return packages.build(Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8))));
        }
        if (method.equals("POST") && path.equals("/api/packages/import")) {
            return packages.importJar(query.get("name"), ex.getRequestBody());
        }
        if (method.equals("POST") && path.equals("/api/packages/fetch")) {
            return packages.fetch(Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8))));
        }
        if (method.equals("POST") && path.startsWith("/api/sim/")) {
            Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            String name = Json.asString(req.get("name"));
            switch (path) {
                case "/api/sim/run":
                    return sim.runAll(Json.asString(req.get("env")));
                case "/api/sim/detail":
                    return sim.detail(name, Json.asString(req.get("env")), Json.asString(req.get("input")),
                        req.containsKey("against") ? String.valueOf(req.get("against") == null ? "" : req.get("against")) : null);
                case "/api/sim/save":
                    return sim.save(name, Json.asString(req.get("driver")), Json.asString(req.get("channel")), Json.asString(req.get("input")));
                case "/api/sim/record":
                    return sim.record(name);
                default:
                    break;
            }
        }
        if (method.equals("POST") && path.startsWith("/api/vault/")) {
            Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            String env = Json.asString(req.get("env"));
            java.util.List<String> drivers = new java.util.ArrayList<>();
            if (req.get("drivers") instanceof java.util.List) {
                for (Object d : (java.util.List<?>) req.get("drivers")) {
                    drivers.add(String.valueOf(d));
                }
            }
            boolean restart = !Boolean.FALSE.equals(req.get("restart"));
            switch (path) {
                case "/api/vault/schema":
                    return vault.refreshSchema(Json.asString(req.get("env")));
                case "/api/vault/app-schema":
                    return vault.refreshAppSchema(Json.asString(req.get("env")), Json.asString(req.get("driver")));
                case "/api/vault/deploy-schema":
                    return vault.deploySchema(Json.asString(req.get("env")), Json.asString(req.get("confirm")));
                case "/api/vault/plan":
                    return vault.plan(env, drivers, restart, Json.asString(req.get("secrets")));
                case "/api/vault/deploy":
                    return vault.deploy(env, drivers, restart, Json.asString(req.get("secrets")), Json.asString(req.get("confirm")));
                case "/api/vault/driver":
                    return vault.lifecycle(env, Json.asString(req.get("driver")), Json.asString(req.get("action")), Json.asString(req.get("confirm")));
                case "/api/vault/trace-level":
                    return vault.traceLevel(env, Json.asString(req.get("driver")), (int) Double.parseDouble(String.valueOf(req.get("level"))), Json.asString(req.get("server")), Json.asString(req.get("confirm")));
                default:
                    break;
            }
        }
        throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
    }

    /** A repeatable query parameter arrives joined by newlines ({@link #query}). */
    private static java.util.List<String> list(String joined) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (joined != null) {
            for (String s : joined.split("\n")) {
                if (!s.isBlank()) {
                    out.add(s);
                }
            }
        }
        return out;
    }

    /** A driver's trace as server-sent events, one line each, until the page closes the stream. */
    private void trace(HttpExchange ex, Workspace w, Map<String, String> query) throws IOException {
        VaultService vault = w.vault;
        ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(200, 0);
        Thread me = Thread.currentThread();
        OutputStream out = ex.getResponseBody();
        Object lock = new Object();
        // a comment line every ten seconds: an idle driver sends nothing, and a closed page is only noticed on a write
        Thread beat = new Thread(() -> {
            try {
                while (true) {
                    Thread.sleep(10_000);
                    synchronized (lock) {
                        write(out, ": keep-alive\n\n");
                    }
                }
            } catch (IOException e) {
                me.interrupt();
            } catch (InterruptedException e) {
                // the stream ended
            }
        }, "trace-beat");
        beat.setDaemon(true);
        beat.start();
        try {
            synchronized (lock) {
                write(out, "event: open\ndata: {}\n\n");
            }
            vault.trace(required(query, "env"), query.get("driver"), "true".equals(query.get("engine")), query.get("server"), record -> {
                try {
                    synchronized (lock) {
                        write(out, "data: " + Json.compact(record) + "\n\n");
                    }
                } catch (IOException e) {
                    me.interrupt();
                }
            });
        } catch (InterruptedException e) {
            // the page closed the stream
        } catch (Exception e) {
            try {
                synchronized (lock) {
                    write(out, "event: fail\ndata: " + Json.compact(String.valueOf(e.getMessage())) + "\n\n");
                }
            } catch (IOException ignore) {
                // nobody is listening
            }
        } finally {
            beat.interrupt();
            Thread.interrupted();
            try {
                out.close();
            } catch (IOException ignore) {
                // already gone
            }
        }
    }

    private static String coreVersion() {
        try {
            return com.pointblue.dirxml.dev.Version.current();
        } catch (LinkageError e) {
            return null;   // a DirXMLDev older than 0.7.0
        }
    }

    private static Map<String, String> strings(Object o) {
        Map<String, String> out = new LinkedHashMap<>();
        if (o instanceof Map) {
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                if (e.getValue() != null) {
                    out.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                }
            }
        }
        return out;
    }

    private Object credentialsRoute(CredentialService credentials, Session session, String method, String path, Map<String, String> query, HttpExchange ex) throws IOException {
        if (method.equals("GET")) {
            switch (path) {
                case "/api/credentials":
                    return credentials.list();
                case "/api/credentials/secrets":
                    return credentials.secrets(required(query, "env"));
                default:
                    throw new TreeService.NotFound("no such endpoint: GET " + path);
            }
        }
        Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
        switch (path) {
            case "/api/credentials/test":
                return credentials.test(req);
            case "/api/credentials/resolve":
                // a command typed into the page runs on this host as the server's user: that is the
                // deployer's to do (#38); resolving a saved credential by its key stays open to editors
                if (!session.principal.deployer && req.get("command") != null && !Json.asString(req.get("command")).isBlank()) {
                    throw new Forbidden("running a command to test a secret manager needs the deployer role");
                }
                return credentials.resolve(req);
            case "/api/credentials/environment":
                return credentials.save(req);
            case "/api/credentials/environment/remove":
                return credentials.remove(Json.asString(req.get("name")));
            case "/api/credentials/secret":
                return credentials.setSecret(req);
            default:
                throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
        }
    }

    private Object setupRoute(Session session, String method, String path, Map<String, String> query, HttpExchange ex) throws IOException {
        if (method.equals("GET") && path.equals("/api/setup")) {
            return setup.state();
        }
        if (method.equals("GET") && path.equals("/api/setup/driversets")) {
            return setup.driverSets(required(query, "env"));
        }
        if (!method.equals("POST")) {
            throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
        }
        if (!session.principal.deployer && !session.principal.editor) {
            throw new TreeService.BadRequest("setup needs an account with a role");
        }
        // attaching a path of this host (a checkout in place, a repository, a directory of files) is the
        // deployer's (#41); an upload, a vault export or a clone stays an editor's
        if (!session.principal.deployer && (path.equals("/api/setup/project") || path.equals("/api/setup/existing") || path.equals("/api/setup/directory"))) {
            throw new Forbidden("attaching a path on this host needs the deployer role");
        }
        if (path.equals("/api/setup/upload")) {
            return setup.fromUpload(session, query.get("project"), query.get("kind"), query.get("name"), ex.getRequestBody());
        }
        Map<String, Object> req = SetupService.json(ex.getRequestBody());
        String project = Json.asString(req.get("project"));
        switch (path) {
            case "/api/setup/vault":
                return setup.fromVault(session, project, Json.asString(req.get("env")), Json.asString(req.get("driverSet")));
            case "/api/setup/project":
                return setup.fromProjectPath(session, project, Json.asString(req.get("path")));
            case "/api/setup/existing":
                return setup.existingRepository(session, project, Json.asString(req.get("path")));
            case "/api/setup/directory":
                return setup.fromDirectory(session, project, Json.asString(req.get("path")));
            case "/api/setup/clone":
                return setup.cloneRemote(session, project, Json.asString(req.get("url")), Json.asString(req.get("token")), Json.asString(req.get("base")));
            case "/api/setup/remove":
                return setup.remove(session, project);
            default:
                throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
        }
    }

    /** A request the role may not make (403). */
    static final class Forbidden extends RuntimeException {
        Forbidden(String message) {
            super(message);
        }
    }

    /** What an audit line keeps of a response: names and flags, never contents. */
    private static Map<String, Object> summary(Object body) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (body instanceof Map) {
            for (String k : new String[] {"operation", "environment", "driver", "action", "name", "dryRun", "written", "changedFiles", "done", "snapshot", "refusal"}) {
                Object v = ((Map<?, ?>) body).get(k);
                if (v != null && !(v instanceof java.util.List && ((java.util.List<?>) v).isEmpty())) {
                    out.put(k, v);
                }
            }
        }
        return out;
    }

    private static String outcome(Object body) {
        if (body instanceof Map) {
            Object ok = ((Map<?, ?>) body).get("ok");
            if (ok instanceof Boolean) {
                return (Boolean) ok ? "ok" : "refused";
            }
        }
        return "ok";
    }

    private Object gitRoute(Session session, Workspace w, String method, String path, Map<String, String> query, HttpExchange ex) throws IOException {
        Project project = workspaces.projectOf(w);
        Git git = project == null ? workspaces.git() : workspaces.gitFor(project);
        String base = project == null ? null : project.base;
        if (method.equals("GET") && path.equals("/api/git/diff")) {
            String against = query.getOrDefault("against", "head");
            String ref;
            switch (against) {
                case "head": ref = "HEAD"; break;
                case "upstream": ref = "@{upstream}"; break;
                case "base": {
                    String b = base != null ? base : query.get("base");
                    if (b == null || b.isBlank()) {
                        throw new TreeService.BadRequest("which base branch?");
                    }
                    ref = git.run(w.root, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + b).ok() ? "origin/" + b : b;
                    break;
                }
                default:
                    throw new TreeService.BadRequest("against is head, base or upstream");
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("against", against);
            m.put("ref", ref);
            m.put("files", git.diff(w.root, ref, 200));
            return m;
        }
        if (method.equals("GET") && path.equals("/api/git/status")) {
            Map<String, Object> m = git.status(w.root, base);
            if (base == null && Boolean.TRUE.equals(m.get("repository"))) {
                // local mode: the branch the tree sits on is compared with main or master, whichever exists
                for (String b : new String[] {"main", "master"}) {
                    if (git.run(w.root, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + b).ok()) {
                        m.put("base", b);
                        m.put("compareUrl", Git.compareUrl((String) m.get("remote"), b, (String) m.get("branch")));
                        break;
                    }
                }
            }
            return m;
        }
        if (method.equals("POST")) {
            Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            switch (path) {
                case "/api/git/commit": {
                    boolean push = Boolean.TRUE.equals(req.get("push"));
                    Map<String, Object> r = git.commit(w.root, Json.asString(req.get("message")), session.principal.name, session.principal.email, push);
                    audit.log(session, w, push ? "commit+push" : "commit", Map.of("message", String.valueOf(req.get("message")), "hash", String.valueOf(r.get("hash"))), "ok");
                    return r;
                }
                case "/api/git/update": {
                    String b = base != null ? base : Json.asString(req.get("base"));
                    if (b == null || b.isBlank()) {
                        throw new TreeService.BadRequest("which branch to update from?");
                    }
                    Map<String, Object> r = git.update(w.root, b);
                    audit.log(session, w, "update", Map.of("from", b), Boolean.TRUE.equals(r.get("merged")) ? "ok" : "conflict");
                    return r;
                }
                default:
                    break;
            }
        }
        throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
    }

    private static String required(Map<String, String> query, String key) {
        String v = query.get(key);
        if (v == null || v.isBlank()) {
            throw new TreeService.BadRequest("missing ?" + key + "=");
        }
        return v;
    }

    static Map<String, String> query(String raw) {
        Map<String, String> out = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) {
            return out;
        }
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            String k = eq < 0 ? pair : pair.substring(0, eq);
            String v = eq < 0 ? "" : pair.substring(eq + 1);
            out.merge(URLDecoder.decode(k, StandardCharsets.UTF_8), URLDecoder.decode(v, StandardCharsets.UTF_8), (a, b) -> a + "\n" + b);
        }
        return out;
    }

    private static Map<String, Object> error(String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", message);
        return m;
    }

    private static void send(HttpExchange ex, int status, Object body) throws IOException {
        byte[] bytes = Json.compact(body).getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(bytes);
        }
    }

    /** One revision per change, and a comment line every fifteen seconds so a dead client is noticed. */
    private void events(HttpExchange ex, Workspace w) throws IOException {
        Watcher watcher = w.watcher;
        ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(200, 0);
        BlockingQueue<String> queue = new LinkedBlockingQueue<>();
        Consumer<String> listener = queue::offer;
        watcher.onChange(listener);
        try (OutputStream out = ex.getResponseBody()) {
            write(out, "event: tree\ndata: {\"revision\":\"" + watcher.revision() + "\"}\n\n");
            while (true) {
                String rev = queue.poll(15, TimeUnit.SECONDS);
                write(out, rev == null ? ": keep-alive\n\n" : "event: tree\ndata: {\"revision\":\"" + rev + "\"}\n\n");
            }
        } catch (IOException e) {
            // the page closed
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            watcher.remove(listener);
        }
    }

    private static void write(OutputStream out, String s) throws IOException {
        out.write(s.getBytes(StandardCharsets.UTF_8));
        out.flush();
    }
}
