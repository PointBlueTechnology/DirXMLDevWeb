package com.pointblue.dirxml.web;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Who is at the page and which workspace they have open. Local mode has one session, made
 * for the token the server printed; hosted mode makes one per sign-in, kept by a cookie.
 */
public final class Session {

    /** The signed-in person: a subject, a display name, an email and the roles the configuration grants them. */
    public static final class Principal {
        public final String subject;
        public final String name;
        public final String email;
        public final List<String> groups;
        public final boolean editor;
        public final boolean deployer;

        public Principal(String subject, String name, String email, List<String> groups, boolean editor, boolean deployer) {
            this.subject = subject;
            this.name = name;
            this.email = email;
            this.groups = List.copyOf(groups);
            this.editor = editor;
            this.deployer = deployer;
        }

        public static Principal local() {
            String user = System.getProperty("user.name", "local");
            return new Principal(user, user, null, List.of(), true, true);
        }
    }

    private static final SecureRandom RANDOM = new SecureRandom();

    public final String id;
    public final Principal principal;
    public final String csrf;
    public final Instant created = Instant.now();
    public volatile Instant lastSeen = Instant.now();
    public volatile String workspace;
    /** An agent's session, made for its bearer token: no cookie, so the CSRF check does not apply. */
    public volatile boolean bearer;

    Session(String id, Principal principal) {
        this.id = id;
        this.principal = principal;
        this.csrf = token();
    }

    static String token() {
        byte[] b = new byte[24];
        RANDOM.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }

    /** The sessions the server knows, by id. */
    public static final class Store {
        private final Map<String, Session> sessions = new ConcurrentHashMap<>();
        private final long maxAgeSeconds;

        public Store(long maxAgeSeconds) {
            this.maxAgeSeconds = maxAgeSeconds;
        }

        public Session create(Principal p) {
            Session s = new Session(token(), p);
            sessions.put(s.id, s);
            return s;
        }

        /** A session the server made with a known id (local mode: the printed token). */
        public Session createWithId(String id, Principal p) {
            Session s = new Session(id, p);
            sessions.put(id, s);
            return s;
        }

        public Session get(String id) {
            if (id == null) {
                return null;
            }
            Session s = sessions.get(id);
            if (s == null) {
                return null;
            }
            if (s.lastSeen.plusSeconds(maxAgeSeconds).isBefore(Instant.now())) {
                sessions.remove(id);
                return null;
            }
            s.lastSeen = Instant.now();
            return s;
        }

        public void remove(String id) {
            if (id != null) {
                sessions.remove(id);
            }
        }
    }
}
