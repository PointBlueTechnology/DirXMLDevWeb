package com.pointblue.dirxml.web;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * {@code /auth/login}, {@code /auth/callback}, {@code /auth/logout}: the sign-in round trip of
 * hosted mode, ending in the session cookie ({@code HttpOnly; SameSite=Strict; Secure} when the
 * public URL is https).
 */
public final class Auth implements HttpHandler {

    private final Identity identity;
    private final Session.Store sessions;
    private final Security security;
    private final Audit audit;
    private final boolean secure;

    public Auth(Identity identity, Session.Store sessions, Security security, Audit audit, String publicUrl) {
        this.identity = identity;
        this.sessions = sessions;
        this.security = security;
        this.audit = audit;
        this.secure = publicUrl.startsWith("https://");
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        String refusal = security.refuse(ex.getRequestHeaders().getFirst("Host"), ex.getRequestHeaders().getFirst("Origin"), null);
        if (refusal != null) {
            text(ex, 403, refusal);
            return;
        }
        String path = ex.getRequestURI().getPath();
        java.util.Map<String, String> query = Api.query(ex.getRequestURI().getRawQuery());
        try {
            switch (path) {
                case "/auth/login":
                    identity.login(ex, safeNext(query.get("next")));
                    return;
                case "/auth/callback": {
                    Session.Principal p = identity.callback(ex);
                    if (p == null) {
                        return;
                    }
                    Session s = sessions.create(p);
                    Object attr = ex.getAttribute("next");
                    String next = safeNext(attr instanceof String ? (String) attr : null);
                    ex.getResponseHeaders().add("Set-Cookie", Api.COOKIE + "=" + s.id + "; Path=/; HttpOnly; SameSite=Strict" + (secure ? "; Secure" : ""));
                    audit.log(s, null, "sign-in", java.util.Map.of("provider", identity.name()), "ok");
                    redirect(ex, next);
                    return;
                }
                case "/auth/logout": {
                    Session s = sessions.get(Api.cookie(ex, Api.COOKIE));
                    if (s != null) {
                        audit.log(s, null, "sign-out", java.util.Map.of(), "ok");
                        sessions.remove(s.id);
                    }
                    ex.getResponseHeaders().add("Set-Cookie", Api.COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict" + (secure ? "; Secure" : ""));
                    redirect(ex, "/");
                    return;
                }
                default:
                    text(ex, 404, "not found");
            }
        } catch (TreeService.BadRequest e) {
            text(ex, 400, e.getMessage());
        } catch (IOException e) {
            // the identity provider could not be reached or answered badly: say so, in words
            text(ex, 502, "the identity provider could not be reached: " + e.getMessage());
        }
    }

    /** Only a path on this server is a valid place to go next. */
    static String safeNext(String next) {
        return next == null || !next.startsWith("/") || next.startsWith("//") ? "/" : next;
    }

    static void redirect(HttpExchange ex, String to) throws IOException {
        ex.getResponseHeaders().set("Location", to);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(303, -1);
        ex.close();
    }

    static void text(HttpExchange ex, int status, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        ex.sendResponseHeaders(status, b.length);
        ex.getResponseBody().write(b);
        ex.close();
    }

    static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
