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

    private final String token;
    private final int port;

    public Security(String token, int port) {
        this.token = token;
        this.port = port;
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
