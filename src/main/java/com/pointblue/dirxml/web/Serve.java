package com.pointblue.dirxml.web;

import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * {@code idmweb serve <tree> [--port N] [--no-open] [--web DIR]}: serve the workbench for one
 * as-code tree from this workstation. Loopback only; the URL printed carries the session token.
 */
public final class Serve {

    public static final String VERSION = "0.5.0";

    private Serve() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length >= 1 && args[0].equals("version")) {
            System.out.println("DirXMLDevWeb " + VERSION);
            return;
        }
        if (args.length >= 3 && args[0].equals("serve") && args[1].equals("--hosted")) {
            hosted(Path.of(args[2]));
            return;
        }
        if (args.length < 2 || !args[0].equals("serve")) {
            System.err.println("usage: idmweb serve <tree> [--port N] [--no-open] [--web DIR] [--cases DIR] [--catalog DIR]\n       idmweb serve --hosted <hosted.properties>\n       idmweb version");
            System.exit(2);
        }
        Path tree = Path.of(args[1]).toAbsolutePath().normalize();
        int port = 0;
        boolean open = true;
        Path cases = null;
        Path catalog = null;
        Path web = Path.of(System.getProperty("idmweb.home", System.getProperty("user.dir")), "web", "dist");
        for (int i = 2; i < args.length; i++) {
            switch (args[i]) {
                case "--port": port = Integer.parseInt(args[++i]); break;
                case "--no-open": open = false; break;
                case "--web": web = Path.of(args[++i]); break;
                case "--cases": cases = Path.of(args[++i]); break;
                case "--catalog": catalog = Path.of(args[++i]); break;
                default:
                    System.err.println("unexpected argument '" + args[i] + "'");
                    System.exit(2);
            }
        }
        if (!Files.isRegularFile(tree.resolve("driverset.xml"))) {
            System.err.println("ERROR: " + tree + " is not an IDM-as-code tree (no driverset.xml). Import one with `idm import-live`, `import` or `import-ldif`.");
            System.exit(1);
        }
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
        int bound = server.getAddress().getPort();
        Security security = new Security(Security.newToken(), bound);
        Workspaces workspaces = new Workspaces(null, new Git(null, null));
        Workspace local = workspaces.local(tree, cases, PackageService.locate(catalog, System.getenv("IDM_CATALOG")));
        Session.Store sessions = new Session.Store(365L * 24 * 3600);   // local mode: the token lives as long as the server
        Session session = sessions.createWithId(security.token(), Session.Principal.local());
        session.workspace = local.id;
        server.createContext("/api/", new Api(workspaces, sessions, security, Audit.none(), VERSION));
        server.createContext("/", new StaticFiles(web));
        start(server);
        String url = "http://127.0.0.1:" + bound + "/#token=" + security.token();
        System.out.println("DirXMLDevWeb " + VERSION + " serving " + tree);
        System.out.println(url);
        System.out.println("Loopback only. The token in that URL is this session's key; Ctrl-C stops the server.");
        if (open) {
            open(url);
        }
        Thread.currentThread().join();
    }

    /** {@code serve --hosted hosted.properties}: sign-in, a workspace per user and branch, audit. */
    static void hosted(Path config) throws Exception {
        Hosted h = Hosted.load(config);
        Path web = Path.of(System.getProperty("idmweb.home", System.getProperty("user.dir")), "web", "dist");
        Files.createDirectories(h.dataDir);
        CredentialService.override = h.environmentsFile;
        String envVar = System.getenv("IDM_ENVIRONMENTS");
        if (envVar == null || !Path.of(envVar).toAbsolutePath().normalize().equals(h.environmentsFile.toAbsolutePath().normalize())) {
            System.err.println("WARNING: set IDM_ENVIRONMENTS=" + h.environmentsFile + " in the server's environment so the core reads the same environments file the page edits (the launcher does this from environments.file).");
        }
        Git git = new Git(h.dataDir, h.repoToken(), h.repoSshKey);
        Workspaces workspaces = new Workspaces(h, git);
        Session.Store sessions = new Session.Store(h.sessionHours * 3600);
        Security security = Security.hosted(h.publicUrl);
        Audit audit = new Audit(h.dataDir.resolve("audit.log"));
        Identity identity;
        switch (h.identity) {
            case "none":
                identity = new NoneIdentity(h);
                break;
            case "oidc":
                identity = new OidcIdentity(h);
                break;
            case "token":
                identity = new TokenIdentity(h);
                break;
            default:
                throw new IllegalArgumentException("identity is none, token or oidc, not '" + h.identity + "'");
        }
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getByName(h.bind), h.port), 0);
        Map<String, Session.Principal> agents = h.agents();
        Api api = new Api(workspaces, sessions, security, audit, VERSION, agents).withSetup(new SetupService(h, workspaces, audit), new CredentialService(h.dataDir));
        server.createContext("/api/", api);
        server.createContext("/auth/", new Auth(identity, sessions, security, audit, h.publicUrl));
        server.createContext("/", new StaticFiles(web));
        start(server);
        System.out.println("DirXMLDevWeb " + VERSION + " hosted: " + h.publicUrl + " (bound " + h.bind + ":" + h.port + "), identity " + identity.name() + ", " + agents.size() + " agent(s), repository " + (h.inPlace != null ? h.inPlace + " (in place)" : h.repoUrl == null ? "none yet (setup on first visit)" : h.repoUrl.replaceAll("://[^@/]+@", "://")) + ", data " + h.dataDir);
        Thread.currentThread().join();
    }

    private static void start(HttpServer server) {
        server.setExecutor(Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "idmweb-http");
            t.setDaemon(true);
            return t;
        }));
        server.start();
    }

    private static void open(String url) {
        String os = System.getProperty("os.name", "").toLowerCase();
        String[] cmd = os.contains("mac") ? new String[] {"open", url}
            : os.contains("win") ? new String[] {"cmd", "/c", "start", "", url} : new String[] {"xdg-open", url};
        try {
            new ProcessBuilder(cmd).redirectErrorStream(true).start();
        } catch (Exception e) {
            // no browser to open: the URL is printed
        }
    }
}
