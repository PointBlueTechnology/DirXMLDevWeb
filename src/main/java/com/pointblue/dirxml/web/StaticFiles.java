package com.pointblue.dirxml.web;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * The built page ({@code web/dist}). It holds no data and needs no token: everything it shows
 * comes from the API, which does. Unknown paths fall back to {@code index.html}.
 */
public final class StaticFiles implements HttpHandler {

    private static final Map<String, String> TYPES = Map.of(
        "html", "text/html; charset=utf-8", "js", "text/javascript; charset=utf-8", "css", "text/css; charset=utf-8",
        "json", "application/json; charset=utf-8", "svg", "image/svg+xml", "png", "image/png",
        "woff2", "font/woff2", "ttf", "font/ttf", "map", "application/json", "ico", "image/x-icon");

    private final Path root;

    public StaticFiles(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        Path file = root.resolve(path.startsWith("/") ? path.substring(1) : path).normalize();
        if (!file.startsWith(root) || !Files.isRegularFile(file)) {
            file = root.resolve("index.html");
        }
        if (!Files.isRegularFile(file)) {
            byte[] msg = ("The page is not built. Run `npm ci && npm run build` in " + root.getParent() + ".\n").getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
            ex.sendResponseHeaders(503, msg.length);
            try (OutputStream out = ex.getResponseBody()) {
                out.write(msg);
            }
            return;
        }
        String name = file.getFileName().toString();
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
        ex.getResponseHeaders().set("Content-Type", TYPES.getOrDefault(ext, "application/octet-stream"));
        ex.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        ex.getResponseHeaders().set("Cache-Control", name.equals("index.html") ? "no-store" : "public, max-age=3600");
        byte[] bytes = Files.readAllBytes(file);
        ex.sendResponseHeaders(200, bytes.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(bytes);
        }
    }
}
