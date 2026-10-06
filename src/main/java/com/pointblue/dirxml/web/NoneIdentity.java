package com.pointblue.dirxml.web;

import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * No identity provider: a page that lists the configured users and lets one be picked, with no
 * password. For development and tests, and refused unless the server binds to loopback.
 */
public final class NoneIdentity implements Identity {

    private final List<Session.Principal> users;

    public NoneIdentity(Hosted hosted) {
        this.users = hosted.noneUsers();
        if (users.isEmpty()) {
            throw new IllegalArgumentException("identity=none needs none.users");
        }
        try {
            if (!InetAddress.getByName(hosted.bind).isLoopbackAddress()) {
                throw new IllegalArgumentException("identity=none is for a server bound to loopback only; this one binds " + hosted.bind);
            }
        } catch (java.net.UnknownHostException e) {
            throw new IllegalArgumentException("bind: " + e.getMessage());
        }
    }

    @Override
    public String name() {
        return "none";
    }

    @Override
    public void login(HttpExchange ex, String next) throws IOException {
        StringBuilder sb = new StringBuilder("<!doctype html><meta charset=utf-8><title>Sign in</title><style>body{font:15px system-ui;margin:48px auto;max-width:28em;color:#1c2330}button{display:block;width:100%;margin:6px 0;padding:10px;font:inherit;border:1px solid #d9dde3;border-radius:6px;background:#fff;cursor:pointer}button:hover{background:#f4f5f7}</style>");
        sb.append("<h1>DirXMLDevWeb</h1><p>No identity provider is configured (<code>identity=none</code>); pick who you are.</p>");
        for (Session.Principal p : users) {
            sb.append("<form method=post action=/auth/callback><input type=hidden name=user value=\"").append(esc(p.subject)).append("\"><input type=hidden name=next value=\"").append(esc(next)).append("\"><button>")
                .append(esc(p.name)).append(" <small>(").append(p.deployer ? "deployer" : p.editor ? "editor" : "no role").append(")</small></button></form>");
        }
        byte[] body = sb.toString().getBytes(StandardCharsets.UTF_8);
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
        String user = form.get("user");
        for (Session.Principal p : users) {
            if (p.subject.equals(user)) {
                return p;
            }
        }
        throw new TreeService.BadRequest("no such user");
    }

    static String esc(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace("\"", "&quot;");
    }
}
