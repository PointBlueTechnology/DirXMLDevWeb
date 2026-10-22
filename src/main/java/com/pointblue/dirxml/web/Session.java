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
    /** A personal agent token's label when an agent acts for the person (docs/agents.md); null otherwise. */
    public volatile String via;
    /** Whether the last workspace was already looked for (a failed reopen is not retried on every request). */
    volatile boolean restoreTried;

    Session(String id, Principal principal) {
        this.id = id;
        this.principal = principal;
        this.csrf = token();
    }

    /** A session read back from the store. */
    Session(String id, Principal principal, String csrf, Instant lastSeen) {
        this.id = id;
        this.principal = principal;
        this.csrf = csrf;
        this.lastSeen = lastSeen;
    }

    /** Where a person was: the project and branch they last opened, reopened on their next session. */
    public static final class Last {
        public final String project;
        public final String branch;

        public Last(String project, String branch) {
            this.project = project;
            this.branch = branch;
        }
    }

    static String token() {
        byte[] b = new byte[24];
        RANDOM.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }

    /**
     * The sessions the server knows, by id — and, when given a file, kept there too, so a restart
     * signs nobody out, and each person's last project and branch, reopened on their next session
     * (a timeout never resets where someone was). The file holds session ids: it is the owner's only.
     */
    public static final class Store {
        /** {@code session.hours=0}: a session never expires. */
        public static final long NEVER = 100L * 365 * 24 * 3600;
        private final Map<String, Session> sessions = new ConcurrentHashMap<>();
        private final Map<String, Last> last = new ConcurrentHashMap<>();
        private final long maxAgeSeconds;
        private final java.nio.file.Path file;

        public Store(long maxAgeSeconds) {
            this(maxAgeSeconds, null);
        }

        private Store(long maxAgeSeconds, java.nio.file.Path file) {
            this.maxAgeSeconds = maxAgeSeconds;
            this.file = file;
        }

        /** A store backed by {@code file} (JSON, owner-only), loaded now; sessions past their age are dropped. */
        public static Store persistent(long maxAgeSeconds, java.nio.file.Path file) {
            Store st = new Store(maxAgeSeconds, file);
            st.load();
            return st;
        }

        public Session create(Principal p) {
            Session s = new Session(token(), p);
            sessions.put(s.id, s);
            save();
            return s;
        }

        /** A session the server made with a known id (local mode: the printed token). */
        public Session createWithId(String id, Principal p) {
            Session s = new Session(id, p);
            sessions.put(id, s);
            save();
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
                save();
                return null;
            }
            s.lastSeen = Instant.now();
            return s;
        }

        public void remove(String id) {
            if (id != null) {
                sessions.remove(id);
                save();
            }
        }

        /** The session opened a workspace: kept on it, and remembered for the person. */
        public void opened(Session s, String workspaceId, String project, String branch) {
            s.workspace = workspaceId;
            if (project != null) {
                last.put(s.principal.subject, new Last(project, branch));
            }
            save();
        }

        /** Where the person last was, or null. */
        public Last lastOf(String subject) {
            return last.get(subject);
        }

        private synchronized void save() {
            if (file == null) {
                return;
            }
            try {
                Map<String, Object> root = new java.util.LinkedHashMap<>();
                java.util.List<Object> list = new java.util.ArrayList<>();
                for (Session s : sessions.values()) {
                    Map<String, Object> m = new java.util.LinkedHashMap<>();
                    m.put("id", s.id);
                    m.put("subject", s.principal.subject);
                    m.put("name", s.principal.name);
                    m.put("email", s.principal.email);
                    m.put("groups", new java.util.ArrayList<>(s.principal.groups));
                    m.put("editor", s.principal.editor);
                    m.put("deployer", s.principal.deployer);
                    m.put("csrf", s.csrf);
                    m.put("lastSeen", s.lastSeen.toString());
                    m.put("workspace", s.workspace);
                    m.put("bearer", s.bearer);
                    list.add(m);
                }
                root.put("sessions", list);
                Map<String, Object> lm = new java.util.LinkedHashMap<>();
                for (Map.Entry<String, Last> e : last.entrySet()) {
                    lm.put(e.getKey(), Map.of("project", e.getValue().project, "branch", e.getValue().branch == null ? "" : e.getValue().branch));
                }
                root.put("lastWorkspace", lm);
                java.nio.file.Files.createDirectories(file.getParent());
                java.nio.file.Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
                java.nio.file.Files.writeString(tmp, com.pointblue.dirxml.dev.json.Json.pretty(root));
                try {
                    java.nio.file.Files.setPosixFilePermissions(tmp, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
                } catch (UnsupportedOperationException ignore) {
                    // not a POSIX file system
                }
                java.nio.file.Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
            } catch (java.io.IOException e) {
                System.err.println("WARNING: could not save sessions to " + file + ": " + e.getMessage());
            }
        }

        private void load() {
            if (file == null || !java.nio.file.Files.exists(file)) {
                return;
            }
            try {
                Map<String, Object> root = com.pointblue.dirxml.dev.json.Json.asMap(com.pointblue.dirxml.dev.json.Json.parse(java.nio.file.Files.readString(file)));
                for (Object o : com.pointblue.dirxml.dev.json.Json.asList(root.get("sessions"))) {
                    Map<String, Object> m = com.pointblue.dirxml.dev.json.Json.asMap(o);
                    java.util.List<String> groups = new java.util.ArrayList<>();
                    for (Object g : com.pointblue.dirxml.dev.json.Json.asList(m.get("groups"))) {
                        groups.add(String.valueOf(g));
                    }
                    Principal p = new Principal(str(m.get("subject")), str(m.get("name")), str(m.get("email")), groups,
                        Boolean.TRUE.equals(m.get("editor")), Boolean.TRUE.equals(m.get("deployer")));
                    Instant seen = Instant.parse(str(m.get("lastSeen")));
                    if (seen.plusSeconds(maxAgeSeconds).isBefore(Instant.now())) {
                        continue;
                    }
                    Session s = new Session(str(m.get("id")), p, str(m.get("csrf")), seen);
                    s.workspace = str(m.get("workspace"));
                    s.bearer = Boolean.TRUE.equals(m.get("bearer"));
                    sessions.put(s.id, s);
                }
                Map<String, Object> lm = com.pointblue.dirxml.dev.json.Json.asMap(root.get("lastWorkspace"));
                for (Map.Entry<String, Object> e : lm.entrySet()) {
                    Map<String, Object> v = com.pointblue.dirxml.dev.json.Json.asMap(e.getValue());
                    String b = str(v.get("branch"));
                    last.put(e.getKey(), new Last(str(v.get("project")), b == null || b.isEmpty() ? null : b));
                }
            } catch (RuntimeException | java.io.IOException e) {
                System.err.println("WARNING: sessions file " + file + " not read (" + e.getMessage() + "); starting with none");
            }
        }

        private static String str(Object o) {
            return o == null ? null : String.valueOf(o);
        }
    }
}
