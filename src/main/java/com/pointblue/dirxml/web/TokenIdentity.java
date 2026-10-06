package com.pointblue.dirxml.web;

import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;

/**
 * One shared secret instead of an identity provider: a sign-in page asks for it once, and the
 * person becomes {@code token.user} with every role. For one person on a trusted host — a
 * workstation's container, a lab — where Keycloak would be ceremony. The token is at least 16
 * characters and comes through the usual credential forms ({@code token.value}, {@code .valueEnv},
 * {@code .valueCommand}, {@code .valueKeychain}).
 */
public final class TokenIdentity implements Identity {

    private final byte[] token;
    private final Session.Principal who;

    public TokenIdentity(Hosted hosted) throws IOException {
        String t = hosted.secret("token.value");
        if (t == null || t.length() < 16) {
            throw new IllegalArgumentException("identity=token needs token.value (or .valueEnv/.valueCommand/.valueKeychain) of at least 16 characters");
        }
        this.token = t.getBytes(StandardCharsets.UTF_8);
        String name = hosted.props.getProperty("token.user", System.getProperty("user.name", "me")).trim();
        this.who = new Session.Principal(name, name, hosted.props.getProperty("token.email"), List.of(), true, true);
    }

    @Override
    public String name() {
        return "token";
    }

    @Override
    public void login(HttpExchange ex, String next) throws IOException {
        String page = "<!doctype html><meta charset=utf-8><title>Sign in</title><style>body{font:15px system-ui;margin:48px auto;max-width:28em;color:#1c2330}input,button{font:inherit;padding:8px;border:1px solid #d9dde3;border-radius:6px;width:100%;box-sizing:border-box;margin:6px 0}button{background:#2f6fd0;color:#fff;cursor:pointer}</style>"
            + "<h1>DirXMLDevWeb</h1><p>This server is for one person. Enter its access token.</p>"
            + "<form method=post action=/auth/callback><input type=password name=token autocomplete=current-password autofocus><input type=hidden name=next value=\"" + NoneIdentity.esc(next) + "\"><button>Sign in</button></form>";
        byte[] body = page.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(200, body.length);
        ex.getResponseBody().write(body);
        ex.close();
    }

    @Override
    public Session.Principal callback(HttpExchange ex) throws IOException {
        Map<String, String> form = Api.query(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        ex.setAttribute("next", form.get("next"));
        String given = form.getOrDefault("token", "");
        if (!MessageDigest.isEqual(token, given.getBytes(StandardCharsets.UTF_8))) {
            try {
                Thread.sleep(500);   // a wrong guess costs a moment
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            throw new TreeService.BadRequest("wrong token");
        }
        return who;
    }
}
