package com.pointblue.dirxml.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * Who may talk to the local server. It binds to loopback only, but a page in the same browser
 * could still reach it, so every API request must carry the session token (printed once in the
 * URL the server opens), name this server in its {@code Host} header (a DNS-rebinding page names
 * its own host) and, when the browser sends an {@code Origin}, come from this server's own page.
 */
public final class Security {

    public static final String HEADER = "X-IDMWeb-Token";

    private final String token;      // null in hosted mode: the session cookie stands in for it
    private final int port;
    private final String publicHost; // hosted mode: the host the browser addresses
    private final String publicOrigin;
    /** Hosted mode: every host (and origin) that names this server; the loopback names together when it is on loopback. */
    private final java.util.Set<String> hosts;
    private final java.util.Set<String> origins;

    public Security(String token, int port) {
        this.token = token;
        this.port = port;
        this.publicHost = null;
        this.publicOrigin = null;
        this.hosts = java.util.Set.of();
        this.origins = java.util.Set.of();
    }

    private Security(String publicUrl) {
        this.token = null;
        this.port = 0;
        java.net.URI u = java.net.URI.create(publicUrl);
        this.publicHost = u.getPort() == -1 ? u.getHost() : u.getHost() + ":" + u.getPort();
        this.publicOrigin = u.getScheme() + "://" + publicHost;
        // a server published on this machine's loopback (the one-person container, public.url
        // http://localhost:8080) answers to each loopback name for it: a DNS-rebinding page names a
        // host of its own, never one of these
        java.util.Set<String> h = new java.util.LinkedHashSet<>();
        String port = u.getPort() == -1 ? "" : ":" + u.getPort();
        if (LOOPBACK.contains(u.getHost().toLowerCase(java.util.Locale.ROOT))) {
            for (String name : LOOPBACK) {
                h.add(name + port);
            }
        } else {
            h.add(publicHost.toLowerCase(java.util.Locale.ROOT));
        }
        this.hosts = java.util.Set.copyOf(h);
        java.util.Set<String> o = new java.util.LinkedHashSet<>();
        for (String x : h) {
            o.add(u.getScheme().toLowerCase(java.util.Locale.ROOT) + "://" + x);
        }
        this.origins = java.util.Set.copyOf(o);
    }

    private static final java.util.List<String> LOOPBACK = java.util.List.of("localhost", "127.0.0.1", "[::1]");

    /** Hosted mode: requests must address the public URL's host; the session is a cookie, not a token. */
    public static Security hosted(String publicUrl) {
        return new Security(publicUrl);
    }

    public boolean hostedMode() {
        return token == null;
    }

    public String publicOrigin() {
        return publicOrigin;
    }

    public static String newToken() {
        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) {
            sb.append(String.format("%02x", x));
        }
        return sb.toString();
    }

    public String token() {
        return token;
    }

    /** Why a request is refused, or null when it may proceed. */
    public String refuse(String host, String origin, String presented) {
        if (token == null) {
            if (host == null || !hosts.contains(host.toLowerCase(java.util.Locale.ROOT))) {
                return "this server answers only as " + String.join(" or ", hosts);
            }
            if (origin != null && !origin.isBlank() && !origins.contains(origin.toLowerCase(java.util.Locale.ROOT))) {
                return "requests from another origin are refused";
            }
            return null;
        }
        if (host == null || !(host.equals("127.0.0.1:" + port) || host.equals("localhost:" + port))) {
            return "this server answers only as 127.0.0.1:" + port + " or localhost:" + port;
        }
        if (origin != null && !origin.isBlank()
            && !(origin.equals("http://127.0.0.1:" + port) || origin.equals("http://localhost:" + port))) {
            return "requests from another origin are refused";
        }
        if (presented == null || !MessageDigest.isEqual(presented.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8))) {
            return "missing or wrong session token";
        }
        return null;
    }
}
