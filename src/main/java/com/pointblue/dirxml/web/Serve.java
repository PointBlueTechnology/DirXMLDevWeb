package com.pointblue.dirxml.web;

import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executors;

/**
 * {@code idmweb serve <tree> [--port N] [--no-open] [--web DIR]}: serve the workbench for one
 * as-code tree from this workstation. Loopback only; the URL printed carries the session token.
 */
public final class Serve {

    public static final String VERSION = "0.2.0";

    private Serve() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length >= 1 && args[0].equals("version")) {
            System.out.println("DirXMLDevWeb " + VERSION);
            return;
        }
        if (args.length < 2 || !args[0].equals("serve")) {
            System.err.println("usage: idmweb serve <tree> [--port N] [--no-open] [--web DIR] [--cases DIR] [--catalog DIR]\n       idmweb version");
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
        Watcher watcher = new Watcher(tree, 750);
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
        int bound = server.getAddress().getPort();
        Security security = new Security(Security.newToken(), bound);
        TreeService service = new TreeService(tree, watcher);
        PackageService packageService = new PackageService(tree, PackageService.locate(catalog, System.getenv("IDM_CATALOG")));
        service.catalog(packageService.catalogArg());
        server.createContext("/api/", new Api(service, new VaultService(tree), new SimService(tree, SimService.locate(tree, cases)), new ProvisioningService(tree), packageService, watcher, security, VERSION));
        server.createContext("/", new StaticFiles(web));
        server.setExecutor(Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "idmweb-http");
            t.setDaemon(true);
            return t;
        }));
        watcher.start();
        server.start();
        String url = "http://127.0.0.1:" + bound + "/#token=" + security.token();
        System.out.println("DirXMLDevWeb " + VERSION + " serving " + tree);
        System.out.println(url);
        System.out.println("Loopback only. The token in that URL is this session's key; Ctrl-C stops the server.");
        if (open) {
            open(url);
        }
        Thread.currentThread().join();
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
