package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.json.Json;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
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
    private static final java.util.List<String> DEPLOYER_ONLY = java.util.List.of("/api/vault/deploy", "/api/vault/capture", "/api/vault/driver", "/api/vault/trace-level", "/api/vault/cache-clear", "/api/vault/cache-delete", "/api/vault/deploy-schema", "/api/vault/rollback", "/api/vault/start-option", "/api/vault/job", "/api/vault/health-clear", "/api/vault/log-level", "/api/vault/email-server", "/api/vault/trace-reset", "/api/vault/trace-tail", "/api/vault/resync", "/api/vault/migrate", "/api/vault/submit", "/api/vault/named-password", "/api/export/project", "/api/credentials/environment", "/api/credentials/environment/remove", "/api/credentials/secret");

    private final Workspaces workspaces;
    private final Session.Store sessions;
    private final Security security;
    private final Audit audit;
    private final String version;
    /** #126: a newer release, for the page's top bar. */
    private final WebReleaseCheck release;
    private final Map<String, Session.Principal> agents;
    private final Map<String, String> agentSessions = new java.util.concurrent.ConcurrentHashMap<>();
    private SetupService setup;              // hosted mode only

    private ArchiveService archive;          // hosted mode only (#76)

    private RepositoryService repository;    // hosted mode only (docs/connections-ui.md)

    /** Hosted mode: the first-run setup (the connections view before any workspace is open is built per session), and project archives. */
    public Api withSetup(SetupService setup, ArchiveService archive) {
        this.setup = setup;
        this.archive = archive;
        return this;
    }

    public Api withRepository(RepositoryService repository) {
        this.repository = repository;
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
        this.release = WebReleaseCheck.of(workspaces, version);
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
            if (path.equals("/api/setup/archive/file") && method.equals("GET") && archive != null) {
                if (!session.principal.deployer) {
                    throw new Forbidden("an archive is the deployer's");
                }
                java.nio.file.Path f = archive.bundle(required(query, "name"));
                ex.getResponseHeaders().set("Content-Type", "application/octet-stream");
                ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + f.getFileName() + "\"");
                ex.sendResponseHeaders(200, java.nio.file.Files.size(f));
                try (OutputStream out = ex.getResponseBody()) {
                    java.nio.file.Files.copy(f, out);
                }
                return;
            }
            if (path.startsWith("/api/setup") && setup != null) {
                send(ex, 200, setupRoute(session, method, path, query, ex));
                return;
            }
            if (path.startsWith("/api/credentials/git") && workspaces.hosted()) {
                // #35 P2: the person's own Git provider tokens, by host; reachable before a workspace is open
                send(ex, 200, gitTokensRoute(session, method, path, ex));
                return;
            }
            w = workspaces.get(session.workspace);
            if (w == null && path.startsWith("/api/credentials") && workspaces.hosted()) {
                // the connections are the person's and the project's, not a workspace's: reachable before one is open
                Hosted h = workspaces.config();
                send(ex, 200, credentialsRoute(new CredentialService(h.dataDir, h.envFiles(session.principal)), session, method, path, query, ex));
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
            if (path.equals("/api/vault/cache-file") && method.equals("GET")) {
                // the whole cache as a file: kind=cache (the merged ViewCacheEntries document, for recovery) or input (simulator-ready)
                String kind = "input".equals(query.get("kind")) ? "input" : "cache";
                String doc = w.vault.cacheDocument(required(query, "env"), required(query, "driver"), kind);
                String fname = required(query, "driver").replaceAll("[^A-Za-z0-9._-]+", "-") + "-" + kind + ".xds";
                byte[] bytes = doc.getBytes(StandardCharsets.UTF_8);
                ex.getResponseHeaders().set("Content-Type", "application/xml; charset=utf-8");
                ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + fname + "\"");
                ex.sendResponseHeaders(200, bytes.length);
                try (OutputStream out = ex.getResponseBody()) {
                    out.write(bytes);
                }
                return;
            }
            if (path.equals("/api/vault/trace") && method.equals("GET")) {
                audit.log(session, w, "trace", Map.of("env", String.valueOf(query.get("env")), "driver", String.valueOf(query.get("driver")), "server", String.valueOf(query.get("server")), "record", String.valueOf(query.get("record"))), "started");
                trace(ex, w, query);
                return;
            }
            if (path.equals("/api/traces/upload") && method.equals("POST")) {
                // the raw body is the file (no multipart); the size is checked against the limit as it streams
                String lenHeader = ex.getRequestHeaders().getFirst("Content-Length");
                long len = lenHeader == null ? -1 : Long.parseLong(lenHeader);
                String stored = w.traces.upload(query.get("name"), ex.getRequestBody(), len);
                audit.log(session, w, "traces/upload", Map.of("name", stored, "bytes", String.valueOf(len)), "ok");
                send(ex, 200, Map.of("ok", true, "name", stored));
                return;
            }
            if (path.equals("/api/driver-icon") && method.equals("GET")) {
                Map.Entry<String, byte[]> icon = w.service.driverIcon(required(query, "driver"));
                if (icon == null) {
                    throw new TreeService.NotFound("the driver has no icon");
                }
                String ext = icon.getKey();
                String type = ext.equals("png") ? "image/png" : ext.equals("jpg") ? "image/jpeg" : ext.equals("bmp") ? "image/bmp" : ext.equals("gif") ? "image/gif" : "application/octet-stream";
                ex.getResponseHeaders().set("Content-Type", type);
                ex.getResponseHeaders().set("Cache-Control", "private, max-age=3600");
                ex.sendResponseHeaders(200, icon.getValue().length);
                try (OutputStream out = ex.getResponseBody()) {
                    out.write(icon.getValue());
                }
                return;
            }
            if (path.equals("/api/traces/file") && method.equals("GET")) {
                java.nio.file.Path f = w.traces.path(required(query, "name"));
                if (!java.nio.file.Files.isRegularFile(f)) {
                    throw new TreeService.NotFound("no trace file " + query.get("name"));
                }
                ex.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
                ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + f.getFileName() + "\"");
                ex.sendResponseHeaders(200, java.nio.file.Files.size(f));
                try (OutputStream out = ex.getResponseBody()) {
                    java.nio.file.Files.copy(f, out);
                }
                return;
            }
            if (path.equals("/api/export/designer") && method.equals("GET")) {
                // idm export: the tree as a Designer driver-set export (or one driver's), byte for byte the CLI's (#66)
                DesignerExport d = new DesignerExport(w.tree, w.packages.catalogArg());
                byte[] bytes = d.xml(query.get("driver"));
                ex.getResponseHeaders().set("Content-Type", "application/xml; charset=utf-8");
                ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + d.xmlName(query.get("driver")) + "\"");
                ex.sendResponseHeaders(200, bytes.length);
                try (OutputStream out = ex.getResponseBody()) {
                    out.write(bytes);
                }
                return;
            }
            if (path.equals("/api/export/project-zip") && method.equals("POST")) {
                // a Designer project as a zip (#66): mode=new names one; mode=update takes the uploaded project as the
                // raw body. A dry run answers with the result; an apply streams the project back. Editors may.
                String lenHeader = ex.getRequestHeaders().getFirst("Content-Length");
                long len = lenHeader == null ? -1 : Long.parseLong(lenHeader);
                String mode = query.getOrDefault("mode", "update");
                boolean dryRun = !"false".equals(query.get("dryRun"));
                Object r = new DesignerExport(w.tree, w.packages.catalogArg()).zip(mode, query.get("name"), dryRun, newProject(query::get), ex.getRequestBody(), len);
                Map<String, Object> result = r instanceof DesignerExport.Zip z ? z.result() : Json.asMap(r);
                audit.log(session, w, "export/project-zip", summary(result), outcome(result));
                if (r instanceof DesignerExport.Zip z) {
                    try {
                        ex.getResponseHeaders().set("Content-Type", "application/zip");
                        ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + z.fileName() + "\"");
                        ex.sendResponseHeaders(200, java.nio.file.Files.size(z.file()));
                        try (OutputStream out = ex.getResponseBody()) {
                            java.nio.file.Files.copy(z.file(), out);
                        }
                    } finally {
                        java.nio.file.Files.deleteIfExists(z.file());
                    }
                    return;
                }
                send(ex, 200, result);
                return;
            }
            Object body = route(session, w, method, path, query, ex);
            boolean startedTask = body instanceof Map && Boolean.TRUE.equals(((Map<?, ?>) body).get("started")) && ((Map<?, ?>) body).containsKey("task");
            if (!method.equals("GET") && !path.startsWith("/api/git/") && !path.startsWith("/api/sim/detail") && !startedTask) {
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
            if (e instanceof RuntimeException) {
                // a bug, not a refusal or an unreachable vault: the stack trace goes to the server log (#116),
                // the page says where to find it
                System.err.println("error: " + ex.getRequestMethod() + " " + ex.getRequestURI().getPath() + ": " + e);
                e.printStackTrace();
                send(ex, 500, error(e.getClass().getSimpleName() + ": " + e.getMessage() + " (an internal error; the server log has the details)"));
                return;
            }
            send(ex, 500, error(e.getClass().getSimpleName() + ": " + e.getMessage()));
        }
    }

    private Map<String, Object> sessionInfo(Session session) {
        Workspace w = workspaces.get(session.workspace);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", "DirXMLDevWeb");
        m.put("version", version);
        m.put("core", coreVersion());
        m.put("newerRelease", release.newer());
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
                    m.put("yours", workspaces.yourBranches(which, session.principal));
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
        if (method.equals("GET") && path.equals("/api/vault/task")) {
            // a deploy or rollback's progress and result: by id, or the latest for an environment (none: {})
            VaultTasks.Task t = query.get("id") != null ? VaultTasks.get(query.get("id")) : VaultTasks.latest(required(query, "env"));
            return t == null ? Map.of() : t.json();
        }
        if (path.startsWith("/api/credentials")) {
            return credentialsRoute(credentials, session, method, path, query, ex);
        }
        if (method.equals("GET")) {
            switch (path) {
                case "/api/architecture":
                    return service.architecture();
                case "/api/developer":
                    return service.developer();
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
                case "/api/vault/snapshots":
                    return vault.snapshots(required(query, "env"));
                case "/api/vault/jobs":
                    return vault.jobs(required(query, "env"));
                case "/api/vault/rbe":
                    return vault.rbe(required(query, "env"));
                case "/api/vault/health":
                    return vault.health(required(query, "env"), query.get("driver"));
                case "/api/vault/engine":
                    return vault.engine(required(query, "env"));
                case "/api/vault/driver-status":
                    return vault.driverStatus(required(query, "env"), query.get("driver"));
                case "/api/vault/trace-show":
                    return vault.traceShow(required(query, "env"), query.get("driver"));
                case "/api/vault/named-passwords":
                    return vault.namedPasswords(required(query, "env"), query.get("driver"));
                case "/api/vault/log-level":
                    return vault.logLevel(required(query, "env"), query.get("driver"));
                case "/api/vault/rights":
                    return vault.rights(required(query, "env"), query.get("driver"), query.get("dn"), list(query.get("attr")));
                case "/api/vault/driverset":
                    return vault.driverset(required(query, "env"));
                case "/api/vault/metrics":
                    return vault.metrics(required(query, "env"), query.get("base"));
                case "/api/vault/workorders":
                    return vault.workOrders(required(query, "env"), query.get("base"));
                case "/api/vault/email-server":
                    return vault.emailServer(required(query, "env"));
                case "/api/vault/rbe-members":
                    return vault.rbeMembers(required(query, "env"), query.get("policy"));
                case "/api/vault/associations":
                    return vault.associations(required(query, "env"), required(query, "driver"), query.get("state"), query.get("limit") == null ? 50 : Integer.parseInt(query.get("limit")));
                case "/api/vault/inspect":
                    return vault.inspect(required(query, "env"), query.get("dn"));
                case "/api/vault/password-sync":
                    return vault.passwordSync(required(query, "env"), required(query, "driver"));
                case "/api/vault/schema-diff":
                    return vault.schemaDiff(required(query, "env"), query.get("other"));
                case "/api/vault/status":
                    return vault.status(required(query, "env"));
                case "/api/vault/servers":
                    return vault.servers(required(query, "env"));
                case "/api/traces":
                    return Map.of("dir", w.traces.dir().toString(), "files", w.traces.list());
                case "/api/traces/records":
                    return w.traces.records(required(query, "name"), query.get("from") == null ? 0 : Integer.parseInt(query.get("from")), query.get("count") == null ? 15000 : Integer.parseInt(query.get("count")), TraceFiles.channels(query.get("channels")), query.get("driver"), query.get("text"));
                case "/api/vault/cache":
                    return vault.cacheView(required(query, "env"), required(query, "driver"), query.get("from") == null ? 0 : Integer.parseInt(query.get("from")), query.get("count") == null ? 200 : Integer.parseInt(query.get("count")), "true".equals(query.get("fresh")));
                case "/api/eventlog/describe":
                    return w.events.describe(required(query, "env"));
                case "/api/eventlog":
                    return w.events.list(required(query, "env"), query);
                case "/api/eventlog/event":
                    return w.events.get(required(query, "env"), Long.parseLong(required(query, "id")));
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
        if (method.equals("POST") && path.equals("/api/export/project")) {
            // idm export-project against a directory on the server's host: a deployer's (#66, like attaching host paths)
            Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            return new DesignerExport(w.tree, w.packages.catalogArg()).toPath(Json.asString(req.get("mode")), Json.asString(req.get("path")),
                !Boolean.FALSE.equals(req.get("dryRun")), newProject(req::get), workspaces.hosted() ? workspaces.config().setupRoots : null);
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
        if (method.equals("POST") && path.equals("/api/traces/delete")) {
            Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            w.traces.delete(Json.asString(req.get("name")));
            return Map.of("ok", true);
        }
        if (method.equals("POST") && (path.startsWith("/api/vault/") || path.equals("/api/eventlog/case"))) {
            Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            String env = Json.asString(req.get("env"));
            java.util.List<String> drivers = new java.util.ArrayList<>();
            if (req.get("drivers") instanceof java.util.List) {
                for (Object d : (java.util.List<?>) req.get("drivers")) {
                    drivers.add(String.valueOf(d));
                }
            }
            boolean restart = !Boolean.FALSE.equals(req.get("restart"));
            // one write at a time per environment: while a deploy or rollback to it runs, its other writes wait
            if (env != null && DEPLOYER_ONLY.contains(path) && !path.equals("/api/vault/trace-tail")) {
                String busy = VaultTasks.busy(env);
                if (busy != null) {
                    return busyRefusal(env, busy);
                }
            }
            switch (path) {
                case "/api/vault/schema":
                    return vault.refreshSchema(Json.asString(req.get("env")));
                case "/api/vault/app-schema":
                    return vault.refreshAppSchema(Json.asString(req.get("env")), Json.asString(req.get("driver")));
                case "/api/vault/deploy-schema":
                    return vault.deploySchema(Json.asString(req.get("env")), Json.asString(req.get("confirm")));
                case "/api/eventlog/case":
                    return w.events.saveCase(env, (long) Double.parseDouble(String.valueOf(req.get("id"))), Json.asString(req.get("name")), Json.asString(req.get("driver")), Json.asString(req.get("channel")), Boolean.TRUE.equals(req.get("replace")), Boolean.TRUE.equals(req.get("dryRun")));
                case "/api/vault/plan":
                    return vault.plan(env, drivers, deployChoices(req, restart));
                case "/api/vault/capture": {
                    Map<String, Object> r = vault.capture(env);
                    audit.log(session, w, "capture", Map.of("env", String.valueOf(env), "branch", String.valueOf(r.get("capturedBranch"))), Boolean.TRUE.equals(r.get("ok")) ? "ok" : "refused");
                    return r;
                }
                case "/api/vault/deploy":
                    return task(session, w, path, env, Boolean.TRUE.equals(req.get("async")),
                        t -> vault.deploy(env, drivers, deployChoices(req, restart), Json.asString(req.get("confirm")), t::line));
                case "/api/vault/job":
                    return vault.jobAction(env, Json.asString(req.get("job")), Json.asString(req.get("driver")), Json.asString(req.get("action")), Json.asString(req.get("confirm")));
                case "/api/vault/health-clear":
                    return vault.healthClear(env, Json.asString(req.get("driver")), Json.asString(req.get("confirm")));
                case "/api/vault/log-level": {
                    Object lim = req.get("limit");
                    Integer limit = lim == null || String.valueOf(lim).isBlank() ? null : Integer.valueOf(String.valueOf(lim).replaceFirst("\\.0$", ""));
                    return vault.logLevelSet(env, Json.asString(req.get("driver")), Json.asString(req.get("level")), limit, Boolean.TRUE.equals(req.get("inherit")), Json.asString(req.get("confirm")));
                }
                case "/api/vault/email-server": {
                    Map<String, String> values = new java.util.LinkedHashMap<>();
                    Object vs = req.get("values");
                    if (vs instanceof Map<?, ?> vm) {
                        for (Map.Entry<?, ?> en : vm.entrySet()) {
                            values.put(String.valueOf(en.getKey()), en.getValue() == null ? "" : String.valueOf(en.getValue()));
                        }
                    }
                    return vault.emailServerSet(env, values, Json.asString(req.get("confirm")));
                }
                case "/api/vault/query":
                    return vault.query(env, Json.asString(req.get("driver")), Json.asString(req.get("className")), Json.asString(req.get("scope")), Json.asString(req.get("dn")),
                        Json.asString(req.get("association")), stringList(req.get("search")), stringList(req.get("readAttrs")), Json.asString(req.get("confirm")));
                case "/api/vault/start-option":
                    return vault.startOption(env, Json.asString(req.get("driver")), Json.asString(req.get("option")), Json.asString(req.get("confirm")));
                case "/api/vault/rollback":
                    return task(session, w, path, env, Boolean.TRUE.equals(req.get("async")),
                        t -> vault.rollback(env, Json.asString(req.get("snapshot")), Json.asString(req.get("confirm")), Json.asString(req.get("server")), t::line));
                case "/api/vault/driver":
                    return vault.lifecycle(env, Json.asString(req.get("driver")), Json.asString(req.get("action")), Json.asString(req.get("confirm")));
                case "/api/vault/cache-case":
                    return vault.cacheCase(env, Json.asString(req.get("driver")), Json.asString(req.get("name")), Json.asString(req.get("channel")), Boolean.TRUE.equals(req.get("replace")), Boolean.TRUE.equals(req.get("dryRun")));
                case "/api/vault/cache-event-case":
                    return vault.cacheEventCase(env, Json.asString(req.get("driver")), (int) Double.parseDouble(String.valueOf(req.get("index"))) - 1, Json.asString(req.get("name")), Json.asString(req.get("channel")), Boolean.TRUE.equals(req.get("replace")), Boolean.TRUE.equals(req.get("dryRun")));
                case "/api/vault/cache-delete":
                    return vault.cacheDeleteEvent(env, Json.asString(req.get("driver")), (int) Double.parseDouble(String.valueOf(req.get("index"))) - 1, Json.asString(req.get("confirm")));
                case "/api/vault/cache-clear":
                    return vault.cacheClear(env, Json.asString(req.get("driver")), Json.asString(req.get("confirm")));
                case "/api/vault/trace-level": {
                    // the level (per server), the trace file, or both
                    Object lv = req.get("level");
                    boolean hasFile = req.containsKey("file");
                    if (lv == null && !hasFile) {
                        throw new TreeService.BadRequest("give a level, a file, or both");
                    }
                    Map<String, Object> r = null;
                    if (lv != null) {
                        r = vault.traceLevel(env, Json.asString(req.get("driver")), (int) Double.parseDouble(String.valueOf(lv)), Json.asString(req.get("server")), Json.asString(req.get("confirm")));
                        if (!Boolean.TRUE.equals(r.get("ok")) || !hasFile) {
                            return r;
                        }
                    }
                    Map<String, Object> f = vault.traceFile(env, Json.asString(req.get("driver")), Json.asString(req.get("file")), Json.asString(req.get("confirm")));
                    if (r != null) {
                        f.put("text", r.get("text") + "\n" + f.get("text"));
                    }
                    return f;
                }
                case "/api/vault/trace-reset":
                    return vault.traceReset(env, Json.asString(req.get("driver")), Json.asString(req.get("confirm")));
                case "/api/vault/trace-tail": {
                    Object lines = req.get("lines");
                    Object since = req.get("since");
                    Map<String, Object> t = vault.traceTail(env, Json.asString(req.get("driver")), lines == null ? 500 : (int) Double.parseDouble(String.valueOf(lines)),
                        Json.asString(req.get("grep")), since == null || String.valueOf(since).isBlank() ? null : (int) Double.parseDouble(String.valueOf(since)), Json.asString(req.get("confirm")));
                    if (Boolean.TRUE.equals(t.get("ok")) && t.get("lines") instanceof java.util.List<?> ls && !ls.isEmpty() && w != null) {
                        // kept as a trace file of the person's own, so the Trace Viewer can open it
                        StringBuilder sb = new StringBuilder();
                        for (Object l : ls) {
                            sb.append(l).append('\n');
                        }
                        byte[] bytes = sb.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                        String stamp = java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(java.time.ZoneOffset.UTC).format(java.time.Instant.now());
                        String stored = w.traces.upload("ssh-" + env + "-" + Json.asString(req.get("driver")) + "-" + stamp + ".trace", new java.io.ByteArrayInputStream(bytes), bytes.length);
                        t.put("stored", stored);
                    }
                    return t;
                }
                case "/api/vault/pull": {
                    // reading the vault is an editor's (with access to the environment); the tree write goes through review
                    java.util.List<String> notes = new java.util.ArrayList<>();
                    boolean dryRun = !Boolean.FALSE.equals(req.get("dryRun"));
                    if (!dryRun) {
                        service.requireRevision(Json.asString(req.get("revision"))); // before minutes of reading the vault
                    }
                    com.pointblue.dirxml.dev.model.DriverSet live = vault.liveForPull(env, notes);
                    // "files": take only those of the reviewed files (a granular update), the rest of the tree as it is
                    java.util.List<String> only = req.get("files") instanceof java.util.List<?> ? stringList(req.get("files")) : null;
                    // "contents": a line-level merge, the text to write for some of those files instead of the vault's
                    java.util.Map<String, String> contents = null;
                    if (req.get("contents") instanceof java.util.Map<?, ?> cm) {
                        contents = new java.util.LinkedHashMap<>();
                        for (java.util.Map.Entry<?, ?> e : cm.entrySet()) {
                            contents.put(String.valueOf(e.getKey()), e.getValue() == null ? "" : String.valueOf(e.getValue()));
                        }
                    }
                    return service.pull(live, vault.environmentName(env), stringList(req.get("drivers")), dryRun, Json.asString(req.get("revision")), notes, only, contents);
                }
                case "/api/vault/resync":
                    return vault.resync(env, Json.asString(req.get("driver")), Json.asString(req.get("since")), Json.asString(req.get("confirm")));
                case "/api/vault/migrate":
                    return vault.migrateFromApp(env, Json.asString(req.get("driver")), Json.asString(req.get("xds")), Json.asString(req.get("confirm")));
                case "/api/vault/submit":
                    return vault.submit(env, Json.asString(req.get("driver")), Json.asString(req.get("xds")), Boolean.TRUE.equals(req.get("canary")), Json.asString(req.get("confirm")));
                case "/api/vault/named-password": {
                    String value = Json.asString(req.get("value"));
                    return vault.namedPassword(env, Json.asString(req.get("driver")), Json.asString(req.get("action")), Json.asString(req.get("name")), value == null ? null : value.toCharArray(), Json.asString(req.get("confirm")));
                }
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
        com.pointbluetech.dirxml.trace.model.TraceFileWriter recording = null;
        try {
            // record=true: every record of the stream, unfiltered, into a file the Trace files view lists
            if ("true".equals(query.get("record"))) {
                recording = w.traces.record(required(query, "env"), query.get("driver"));
            }
            final com.pointbluetech.dirxml.trace.model.TraceFileWriter rec = recording;
            synchronized (lock) {
                write(out, "event: open\ndata: " + Json.compact(rec == null ? Map.of() : Map.of("recording", w.traces.dir().relativize(rec.path()).toString().replace('\\', '/'))) + "\n\n");
            }
            vault.trace(required(query, "env"), query.get("driver"), "true".equals(query.get("engine")), query.get("server"), record -> {
                try {
                    synchronized (lock) {
                        write(out, "data: " + Json.compact(record) + "\n\n");
                    }
                } catch (IOException e) {
                    me.interrupt();
                }
            }, rec == null ? null : r -> {
                try {
                    synchronized (lock) {
                        rec.write(r, false);   // no server tag: the reader would not see the header behind it
                    }
                } catch (IOException e) {
                    // the recording stops; the stream goes on
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
            if (recording != null) {
                try {
                    recording.close();
                } catch (IOException ignore) {
                    // closing
                }
            }
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

    /** A deploy's choices beyond its scope (#34): secrets mode, first-deploy leniency, drivers to delete. */
    private static VaultService.DeployChoices deployChoices(Map<String, Object> req, boolean restart) {
        VaultService.DeployChoices c = new VaultService.DeployChoices();
        c.restart = restart;
        c.secretsMode = Json.asString(req.get("secrets"));
        c.allowMissingSecrets = Boolean.TRUE.equals(req.get("allowMissingSecrets"));
        java.util.List<String> del = new java.util.ArrayList<>();
        Object d = req.get("deleteDrivers");
        if (d instanceof java.util.List<?> list) {
            for (Object o : list) {
                if (o != null && !String.valueOf(o).isBlank()) {
                    del.add(String.valueOf(o));
                }
            }
        }
        c.deleteDrivers = del;
        c.captureDrift = Boolean.TRUE.equals(req.get("captureDrift"));
        return c;
    }

    private Object credentialsRoute(CredentialService credentials, Session session, String method, String path, Map<String, String> query, HttpExchange ex) throws IOException {
        if (method.equals("GET")) {
            switch (path) {
                case "/api/credentials":
                    return credentials.list();
                case "/api/credentials/secrets":
                    return credentials.secrets(required(query, "env"));
                case "/api/credentials/problems":
                    return credentials.problems();
                case "/api/credentials/servers":
                    return credentials.servers(required(query, "env"));
                default:
                    throw new TreeService.NotFound("no such endpoint: GET " + path);
            }
        }
        Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
        switch (path) {
            case "/api/credentials/driversets":
                return credentials.driverSets(req);
            case "/api/credentials/test":
                return credentials.test(req);
            case "/api/credentials/certificate":
                return credentials.certificate(req);
            case "/api/credentials/check":
                return credentials.check(Json.asString(req.get("env")), !Boolean.FALSE.equals(req.get("fresh")));
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
            case "/api/credentials/mine":
                return credentials.saveMine(req);
            case "/api/credentials/mine/remove":
                return credentials.removeMine(Json.asString(req.get("name")));
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
            return setup.driverSets(session, required(query, "env"));
        }
        if (method.equals("GET") && path.equals("/api/setup/repository")) {
            return repository.describe(required(query, "project"));
        }
        if (method.equals("GET") && path.equals("/api/setup/archives")) {
            if (!session.principal.deployer) {
                throw new Forbidden("archives are the deployer's");
            }
            return Map.of("dir", archive.root().toString(), "archives", archive.list());
        }
        if (!method.equals("POST")) {
            throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
        }
        if (!session.principal.deployer && !session.principal.editor) {
            throw new TreeService.BadRequest("setup needs an account with a role");
        }
        // attaching a path of this host (a checkout in place, a repository, a directory of files) is the
        // deployer's (#41); an upload, a vault export or a clone stays an editor's
        if (!session.principal.deployer && (path.equals("/api/setup/project") || path.equals("/api/setup/existing") || path.equals("/api/setup/directory") || path.equals("/api/setup/archive") || path.equals("/api/setup/remove") || path.startsWith("/api/setup/repository"))) {
            throw new Forbidden("attaching a path on this host, archiving or removing a project needs the deployer role");
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
            case "/api/setup/archive":
                return archive.archive(session, project);
            case "/api/setup/repository/check":
                return repository.check(project, Json.asString(req.get("url")), Json.asString(req.get("token")));
            case "/api/setup/repository/move":
                return repository.move(session, project, Json.asString(req.get("url")), Json.asString(req.get("token")), Json.asString(req.get("confirm")));
            case "/api/setup/repository/change":
                return repository.change(session, project, Json.asString(req.get("url")), Json.asString(req.get("token")), Json.asString(req.get("confirm")));
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
    /** A deploy or rollback: what the page and an agent call. */
    interface VaultWrite {
        Map<String, Object> run(VaultTasks.Task task) throws IOException;
    }

    private static Map<String, Object> busyRefusal(String env, String why) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", false);
        m.put("environment", env);
        m.put("refusal", why);
        m.put("busy", true);
        m.put("text", "REFUSED — " + why);
        return m;
    }

    /**
     * Runs a deploy or rollback as a {@link VaultTasks.Task}, so its progress can be followed
     * ({@code GET /api/vault/task}) and no other write to the environment starts meanwhile. {@code async}
     * (the page): it runs on its own thread, the answer is {@code {task, started}} at once, and the audit line is
     * written when it ends. Otherwise (an agent, a script) the call waits for the result, as before.
     */
    private Map<String, Object> task(Session session, Workspace w, String path, String env, boolean async, VaultWrite write) throws IOException {
        if (env == null || env.isBlank()) {
            throw new TreeService.BadRequest("which environment?");
        }
        Project p = workspaces.projectOf(w);
        VaultTasks.Task t = VaultTasks.start(path.endsWith("/rollback") ? "rollback" : "deploy", env, session.principal.name,
            p == null ? null : p.name, w.branch);
        if (t == null) {
            return busyRefusal(env, VaultTasks.busy(env));
        }
        if (!async) {
            Map<String, Object> r = null;
            try {
                r = write.run(t);
                return r;
            } finally {
                VaultTasks.finish(t, r != null ? r : failed(env, "the " + t.kind + " stopped with an error"));
            }
        }
        Thread th = new Thread(() -> {
            Map<String, Object> r;
            try {
                r = write.run(t);
            } catch (Exception e) {
                r = failed(env, e.getMessage() == null ? e.toString() : e.getMessage());
            }
            VaultTasks.finish(t, r);
            audit.log(session, w, path.substring("/api/".length()), summary(r), outcome(r));
        }, "vault-" + t.kind + "-" + env);
        th.start();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("task", t.id);
        m.put("started", true);
        m.put("environment", env);
        return m;
    }

    private static Map<String, Object> failed(String env, String why) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", false);
        m.put("environment", env);
        m.put("failure", why);
        m.put("text", "FAILED   " + why + "\n");
        return m;
    }

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

    private PullRequests pullRequests;
    private CliPullRequests cli;       // a local install: gh / glab (#35 P3)

    /**
     * #35, docs/pull-requests.md: the branch's request on GitHub or GitLab (GET), or a new one (POST, editors).
     * The credential is the person's own provider token when they have one (P2), else the project's repository
     * token, and then the body says who opened it. Anything the API cannot do falls back to the compare page.
     */
    private Object pullRequest(Session session, Workspace w, Project project, Git git, String base, String method, HttpExchange ex) throws IOException {
        boolean local = project == null || !workspaces.hosted();
        if (base == null) {
            // a local checkout: the base is main or master, whichever the remote has (as /api/git/status says)
            for (String b : new String[] {"main", "master"}) {
                if (git.run(w.root, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + b).ok()) {
                    base = b;
                    break;
                }
            }
        }
        Map<String, Object> st = git.status(w.root, base);
        String branch = (String) st.get("branch");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("branch", branch);
        m.put("base", base);
        m.put("compareUrl", st.get("compareUrl"));
        String reason = null;
        PullRequests.Target target = null;
        String token = null;
        String as = null;
        boolean personal = false;
        if (!Boolean.TRUE.equals(st.get("repository"))) {
            reason = "the tree is not in a git checkout";
        } else if (local) {
            // P3: the provider's CLI, signed in as the person already; nothing stored here
            target = PullRequests.target((String) st.get("remote"), null, null);
            if (target == null) {
                reason = "the remote is not on GitHub or GitLab";
            } else {
                if (cli == null) {
                    cli = CliPullRequests.find();
                }
                String name = CliPullRequests.cliName(target.provider());
                if (cli.executable(target.provider()) == null) {
                    reason = "install " + name + " (" + target.provider().label + "'s CLI) and sign in with `" + name + " auth login` to create one from here";
                } else {
                    String account = cli.account(target, w.root);
                    if (account == null) {
                        reason = name + " is not signed in to " + target.host() + ": run `" + name + " auth login --hostname " + target.host() + "`";
                    } else {
                        as = account + " (through " + name + ")";
                        personal = true;
                    }
                }
            }
            m.put("via", target == null ? null : CliPullRequests.cliName(target.provider()));
        } else {
            try {
                target = PullRequests.target((String) st.get("remote"), project.provider, project.apiUrl);
            } catch (IllegalArgumentException e) {
                reason = e.getMessage();
            }
            if (target == null && reason == null) {
                reason = "the remote is not on GitHub or GitLab (a self-hosted one: set repo.provider and repo.apiUrl)";
            }
            try {
                token = target == null ? null : personalProviderToken(session, target);
            } catch (IOException e) {
                // a reference that does not resolve (an unset variable, a failing command): the project's token
                // stands in, and the person is told why
                m.put("personalTokenError", "your token for " + target.host() + " could not be read: " + e.getMessage());
            }
            as = token == null ? null : session.principal.name;
            personal = token != null;
            if (token == null) {
                token = workspaces.config().tokenFor(project);
                as = "the project's repository token";
            }
            if (token == null && reason == null) {
                reason = "the project has no repository token to call " + target.provider().label + " with";
            }
        }
        if (reason == null && (branch == null || branch.equals(base))) {
            reason = "this is the base branch: a pull request needs a branch of its own";
        }
        // pushed: the remote's copy of this branch holds HEAD (a workspace's push need not set an upstream)
        boolean pushed = branch != null && git.run(w.root, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + branch).ok()
            && git.run(w.root, "merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/" + branch).ok();
        m.put("available", reason == null);
        m.put("reason", reason);
        m.put("provider", target == null ? null : target.provider().label);
        m.put("as", reason == null ? as : null);
        m.put("pushed", pushed);
        if (reason != null) {
            if (!method.equals("GET")) {
                throw new TreeService.BadRequest(reason);
            }
            return m;
        }
        if (!local && pullRequests == null) {
            pullRequests = new PullRequests(workspaces.config().gitTls());
        }
        if (method.equals("GET")) {
            try {
                m.put("request", local ? cli.findOpen(target, w.root, branch) : pullRequests.findOpen(target, token, branch));
            } catch (PullRequests.ProviderError e) {
                m.put("error", e.getMessage());
            }
            // what the dialog starts from: the last commit's subject, and the branch's commits as a list
            String ref = git.run(w.root, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + base).ok() ? "origin/" + base : base;
            Git.Result log = git.run(w.root, "log", "--format=%s", ref + "..HEAD");
            java.util.List<String> subjects = new java.util.ArrayList<>();
            if (log.ok()) {
                for (String l : log.out.split("\n")) {
                    if (!l.isBlank()) {
                        subjects.add(l.strip());
                    }
                }
            }
            m.put("title", subjects.isEmpty() ? branch : subjects.get(0));
            StringBuilder body = new StringBuilder();
            for (int i = subjects.size() - 1; i >= 0; i--) {
                body.append("- ").append(subjects.get(i)).append('\n');
            }
            m.put("body", body.toString());
            return m;
        }
        if (!method.equals("POST")) {
            throw new TreeService.BadRequest("GET or POST");
        }
        if (!pushed) {
            throw new TreeService.BadRequest("push the branch first: the request shows what the remote branch holds");
        }
        Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
        String title = Json.asString(req.get("title"));
        if (title == null || title.isBlank()) {
            throw new TreeService.BadRequest("a pull request needs a title");
        }
        String body = Json.asString(req.get("body"));
        body = body == null ? "" : body.strip();
        if (!personal) {
            // the project's token is someone else's account: say who asked
            body = (body.isEmpty() ? "" : body + "\n\n") + "Opened by " + session.principal.name
                + (session.principal.email == null ? "" : " (" + session.principal.email + ")") + " from DirXMLDevWeb.";
        }
        Map<String, Object> out = new LinkedHashMap<>(m);
        Map<String, Object> auditInfo = new LinkedHashMap<>();
        auditInfo.put("provider", target.provider().label);
        auditInfo.put("base", base);
        auditInfo.put("branch", branch);
        auditInfo.put("as", as);
        try {
            Map<String, Object> created = local
                ? cli.create(target, w.root, base, branch, title.strip(), body, Boolean.TRUE.equals(req.get("draft")))
                : pullRequests.create(target, token, base, branch, title.strip(), body, Boolean.TRUE.equals(req.get("draft")));
            out.put("ok", true);
            out.put("request", created);
            auditInfo.put("number", String.valueOf(created.get("number")));
            auditInfo.put("url", String.valueOf(created.get("url")));
            audit.log(session, w, "pull-request", auditInfo, "ok");
        } catch (PullRequests.ProviderError e) {
            out.put("ok", false);
            out.put("error", e.getMessage());
            audit.log(session, w, "pull-request", auditInfo, "refused");
        }
        return out;
    }

    /** The signed-in person's own token for the remote's host (P2 of docs/pull-requests.md), or null. */
    private String personalProviderToken(Session session, PullRequests.Target target) throws IOException {
        return GitTokens.of(workspaces.config().users, session.principal).resolve(target.host());
    }

    /**
     * {@code GET /api/credentials/git}: the provider hosts of the server's projects and whether the person has a
     * token for each (how it is kept, never the value). {@code POST /api/credentials/git} with {@code host},
     * {@code store} ({@code file} with {@code token}, {@code env:VAR}, {@code command:…}) keeps one;
     * {@code POST /api/credentials/git/remove} with {@code host} forgets it.
     */
    private Object gitTokensRoute(Session session, String method, String path, HttpExchange ex) throws IOException {
        Hosted h = workspaces.config();
        GitTokens tokens = GitTokens.of(h.users, session.principal);
        if (method.equals("GET") && path.equals("/api/credentials/git")) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("hosts", tokens.hosts(h.projects.values()));
            return m;
        }
        if (!method.equals("POST")) {
            throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
        }
        Map<String, Object> req = Json.asMap(Json.parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
        String host = GitTokens.host(Json.asString(req.get("host")));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("host", host);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("host", host);
        switch (path) {
            case "/api/credentials/git": {
                String store = Json.asString(req.get("store"));
                m.put("notes", tokens.save(host, store, Json.asString(req.get("token"))));
                m.put("store", tokens.store(host));
                details.put("store", store != null && store.startsWith("command:") ? "command" : store);
                audit.log(session, null, "git-token", details, "ok");
                return m;
            }
            case "/api/credentials/git/remove":
                m.put("removed", tokens.remove(host));
                audit.log(session, null, "git-token-remove", details, "ok");
                return m;
            default:
                throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
        }
    }

    private Object gitRoute(Session session, Workspace w, String method, String path, Map<String, String> query, HttpExchange ex) throws IOException {
        Project project = workspaces.projectOf(w);
        Git git = project == null ? workspaces.git() : workspaces.gitFor(project);
        String base = project == null ? null : project.base;
        if (path.equals("/api/git/pull-request")) {
            return pullRequest(session, w, project, git, base, method, ex);
        }
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
        if (path.equals("/api/git/merge-into-base")) {
            String why = mergeHereRefusal(w, project, git);
            if (why != null) {
                throw new TreeService.BadRequest(why);
            }
            if (method.equals("GET")) {
                return git.mergePreview(w.root, base);
            }
            Map<String, Object> r = git.mergeInto(w.root, base, session.principal.name, session.principal.email);
            audit.log(session, w, "merge-into-base", Map.of("branch", String.valueOf(r.get("branch")), "base", base),
                Boolean.TRUE.equals(r.get("merged")) ? "ok" : "refused");
            return r;
        }
        if (method.equals("GET") && path.equals("/api/git/status")) {
            Map<String, Object> m = git.status(w.root, base);
            if (Boolean.TRUE.equals(m.get("repository"))) {
                // docs/git-workflow.md: merged on this page, or on the provider as a pull request
                String why = mergeHereRefusal(w, project, git);
                m.put("mergeHere", why == null);
                m.put("mergeReason", why);
            }
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
                    // "record": just the deploy record (deploy-log/ at the tree's top), the rest of the work left uncommitted (#128)
                    boolean record = Boolean.TRUE.equals(req.get("record"));
                    List<String> only = record ? List.of(w.root.relativize(w.tree.resolve(Watcher.DEPLOY_LOG)).toString().replace('\\', '/')) : null;
                    Map<String, Object> r = git.commit(w.root, Json.asString(req.get("message")), session.principal.name, session.principal.email, push, only);
                    audit.log(session, w, (record ? "commit-deploy-record" : "commit") + (push ? "+push" : ""), Map.of("message", String.valueOf(req.get("message")), "hash", String.valueOf(r.get("hash"))), "ok");
                    return r;
                }
                case "/api/git/merge-captured": {
                    // the vault's state a deploy captured (vault.deploy --capture-drift): an as-found/<env>/<time> branch
                    // of this workspace, merged under the person's change so it can be deployed on top of it (#67)
                    String b = Json.asString(req.get("branch"));
                    if (b == null || !b.matches("as-found/[A-Za-z0-9._-]+/[A-Za-z0-9._:-]+")) {
                        throw new TreeService.BadRequest("only a captured as-found/<env>/<time> branch can be merged here");
                    }
                    Map<String, Object> r = git.mergeLocal(w.root, b, session.principal.name, session.principal.email);
                    audit.log(session, w, "merge-captured", Map.of("branch", b), Boolean.TRUE.equals(r.get("merged")) ? "ok" : "conflict");
                    if (!Boolean.TRUE.equals(r.get("merged")) && r.get("conflicts") instanceof List<?> cl && !cl.isEmpty()) {
                        r.put("resolveWith", b);   // the page can settle them: POST /api/git/conflicts {with}
                    }
                    return r;
                }
                case "/api/git/discard": {
                    // one uncommitted file back to the last commit (or gone, when the last commit hasn't it); with
                    // "content", only some of its blocks: the text the page settled on (the rest of the change kept)
                    String f = Json.asString(req.get("file"));
                    Map<String, Object> r;
                    if (req.containsKey("content")) {
                        r = git.discardBlocks(w.root, w.tree, f, Json.asString(req.get("content")));
                    } else {
                        r = git.discard(w.root, f);
                    }
                    audit.log(session, w, req.containsKey("content") ? "discard-blocks" : "discard", Map.of("file", String.valueOf(f)), "ok");
                    return r;
                }
                case "/api/git/update": {
                    String b = base != null ? base : Json.asString(req.get("base"));
                    if (b == null || b.isBlank()) {
                        throw new TreeService.BadRequest("which branch to update from?");
                    }
                    Map<String, Object> r = git.update(w.root, b, session.principal.name, session.principal.email);
                    audit.log(session, w, "update", Map.of("from", b), Boolean.TRUE.equals(r.get("merged")) ? "ok" : "conflict");
                    if (!Boolean.TRUE.equals(r.get("merged")) && r.get("conflicts") instanceof List<?> cl && !cl.isEmpty()) {
                        r.put("resolveWith", "base");
                    }
                    return r;
                }
                case "/api/git/conflicts":
                case "/api/git/resolve": {
                    // conflicts settled on the page: "with" is the base branch ("base") or a captured as-found branch
                    String with = Json.asString(req.get("with"));
                    String ref;
                    if ("base".equals(with)) {
                        String b = base != null ? base : Json.asString(req.get("base"));
                        if (b == null || b.isBlank()) {
                            throw new TreeService.BadRequest("which base branch?");
                        }
                        if (path.equals("/api/git/conflicts")) {
                            git.fetchBranch(w.root, b);
                        }
                        ref = "origin/" + b;
                    } else if (with != null && with.matches("as-found/[A-Za-z0-9._-]+/[A-Za-z0-9._:-]+")) {
                        ref = with;
                    } else {
                        throw new TreeService.BadRequest("with is base, or a captured as-found/<env>/<time> branch");
                    }
                    if (path.equals("/api/git/conflicts")) {
                        return git.conflicts(w.root, ref, session.principal.name, session.principal.email);
                    }
                    Map<String, String> files = new LinkedHashMap<>();
                    if (req.get("files") instanceof Map<?, ?> fm) {
                        for (Map.Entry<?, ?> e : fm.entrySet()) {
                            files.put(String.valueOf(e.getKey()), e.getValue() == null ? null : String.valueOf(e.getValue()));
                        }
                    }
                    Map<String, Object> r = git.resolve(w.root, w.tree, ref, Json.asString(req.get("head")), Json.asString(req.get("theirs")), files,
                        Json.asString(req.get("message")), session.principal.name, session.principal.email);
                    audit.log(session, w, "resolve", Map.of("with", ref, "files", String.valueOf(files.size())), "ok");
                    return r;
                }
                default:
                    break;
            }
        }
        throw new TreeService.NotFound("no such endpoint: " + method + " " + path);
    }



    /**
     * Null when this workspace's branch can be merged into the project's base on this page (docs/git-workflow.md):
     * hosted mode, a repository of the project's own (not a checkout in place), not the base itself, and a remote
     * that is not on GitHub or GitLab — there a pull request is how a branch gets merged, with its reviews.
     */
    private String mergeHereRefusal(Workspace w, Project project, Git git) throws IOException {
        if (project == null || !workspaces.hosted()) {
            return "a checkout of your own: merge with git there";
        }
        if (project.inPlace != null) {
            return "project '" + project.name + "' is a checkout in place: merge with git in it";
        }
        String branch = git.run(w.root, "rev-parse", "--abbrev-ref", "HEAD").out.trim();
        if (project.base == null || project.base.equals(branch)) {
            return "this is " + project.base + " itself: open the branch to merge into it";
        }
        Git.Result remote = git.run(w.root, "remote", "get-url", "origin");
        PullRequests.Target t;
        try {
            t = PullRequests.target(remote.ok() ? remote.out.trim() : null, project.provider, project.apiUrl);
        } catch (IllegalArgumentException e) {
            t = null;
        }
        if (t != null) {
            return "the repository is on " + t.provider().label + ": merge with a " + (t.provider() == PullRequests.Provider.GITLAB ? "merge" : "pull")
                + " request there, where its reviews and rules apply";
        }
        return null;
    }

    /** The vault and server fields {@code export-project --new} takes (never a password: there is no field for one). */
    private static com.pointblue.dirxml.dev.source.NewProject newProject(java.util.function.Function<String, Object> get) {
        java.util.function.Function<String, String> s = k -> get.apply(k) == null ? null : String.valueOf(get.apply(k));
        return new com.pointblue.dirxml.dev.source.NewProject(s.apply("vaultName"), s.apply("vaultHost"), s.apply("vaultUser"), s.apply("server"), s.apply("serverContext"));
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

    /** A JSON array of strings (or a single string), as a list; empty when absent. */
    private static java.util.List<String> stringList(Object o) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (o instanceof java.util.List<?> l) {
            for (Object x : l) {
                if (x != null) {
                    out.add(String.valueOf(x));
                }
            }
        } else if (o != null) {
            out.add(String.valueOf(o));
        }
        return out;
    }
}
