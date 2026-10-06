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
 * The HTTP face of {@link TreeService}. Reads are GETs; a write is {@code POST /api/op/<name>}
 * with the operation's arguments, exactly the CLI's, and {@code dryRun} to preview. Every request
 * passes {@link Security} first. {@code /api/events} is a server-sent stream of tree revisions.
 */
public final class Api implements HttpHandler {

    private final TreeService service;
    private final VaultService vault;
    private final SimService sim;
    private final ProvisioningService prov;
    private final PackageService packages;
    private final CredentialService credentials;
    private final Watcher watcher;
    private final Security security;
    private final String version;

    public Api(TreeService service, VaultService vault, SimService sim, ProvisioningService prov, PackageService packages, CredentialService credentials, Watcher watcher, Security security, String version) {
        this.prov = prov;
        this.credentials = credentials;
        this.packages = packages;
        this.service = service;
        this.vault = vault;
        this.sim = sim;
        this.watcher = watcher;
        this.security = security;
        this.version = version;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
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
            String path = ex.getRequestURI().getPath();
            String method = ex.getRequestMethod();
            if (path.equals("/api/events") && method.equals("GET")) {
                events(ex);
                return;
            }
            if (path.equals("/api/vault/trace") && method.equals("GET")) {
                trace(ex, query);
                return;
            }
            Object body = route(method, path, query, ex);
            send(ex, 200, body);
        } catch (TreeService.NotFound e) {
            send(ex, 404, error(e.getMessage()));
        } catch (TreeService.BadRequest e) {
            send(ex, 400, error(e.getMessage()));
        } catch (TreeService.Stale e) {
            Map<String, Object> m = error(e.getMessage());
            m.put("revision", watcher.revision());
            send(ex, 409, m);
        } catch (Exception e) {
            send(ex, 500, error(e.getClass().getSimpleName() + ": " + e.getMessage()));
        }
    }

    private Object route(String method, String path, Map<String, String> query, HttpExchange ex) throws IOException {
        if (method.equals("GET")) {
            switch (path) {
                case "/api/session": {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("name", "DirXMLDevWeb");
                    m.put("version", version);
                    m.put("core", coreVersion());
                    m.put("tree", service.tree().toString());
                    m.put("revision", watcher.revision());
                    return m;
                }
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
                case "/api/credentials":
                    return credentials.list();
                case "/api/credentials/secrets":
                    return credentials.secrets(required(query, "env"));
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
        if (method.equals("POST") && path.startsWith("/api/credentials/")) {
            Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            switch (path) {
                case "/api/credentials/test":
                    return credentials.test(req);
                case "/api/credentials/resolve":
                    return credentials.resolve(req);
                case "/api/credentials/environment":
                    return credentials.save(req);
                case "/api/credentials/environment/remove":
                    return credentials.remove(Json.asString(req.get("name")));
                case "/api/credentials/secret":
                    return credentials.setSecret(req);
                default:
                    break;
            }
        }
        if (method.equals("POST") && path.equals("/api/packages/build")) {
            return packages.build(Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8))));
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
                case "/api/vault/plan":
                    return vault.plan(env, drivers, restart, Json.asString(req.get("secrets")));
                case "/api/vault/deploy":
                    return vault.deploy(env, drivers, restart, Json.asString(req.get("secrets")), Json.asString(req.get("confirm")));
                case "/api/vault/driver":
                    return vault.lifecycle(env, Json.asString(req.get("driver")), Json.asString(req.get("action")), Json.asString(req.get("confirm")));
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
    private void trace(HttpExchange ex, Map<String, String> query) throws IOException {
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
            vault.trace(required(query, "env"), required(query, "driver"), "true".equals(query.get("engine")), line -> {
                try {
                    synchronized (lock) {
                        write(out, "data: " + Json.compact(line) + "\n\n");
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
    private void events(HttpExchange ex) throws IOException {
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
