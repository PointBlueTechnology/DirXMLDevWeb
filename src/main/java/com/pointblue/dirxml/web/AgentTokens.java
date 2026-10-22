package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.json.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

/**
 * Personal agent tokens (docs/agents.md): a signed-in person makes one for an agent (Claude Code, Cursor, a script),
 * and the agent then acts as that person: their roles, their connections, their workspaces, the audit saying "via"
 * the token's label. Only a SHA-256 of each token is kept, with a snapshot of its owner, in
 * {@code users/<subject>/agent-tokens.json} (owner-only); the snapshot follows the person each time they use the page,
 * so a change of roles reaches their tokens. Tokens expire; an agent cannot make one.
 */
final class AgentTokens {

    static final String FILE = "agent-tokens.json";
    static final String PREFIX = "idmw_";
    static final int DEFAULT_DAYS = 90;

    record Entry(String id, String label, String hash, Instant created, Instant expires, Instant lastUsed, Session.Principal who) {
        Entry used(Instant at) {
            return new Entry(id, label, hash, created, expires, at, who);
        }

        Entry as(Session.Principal p) {
            return new Entry(id, label, hash, created, expires, lastUsed, p);
        }
    }

    private final UserData users;
    private final Path usersDir;
    private final int maxDays;
    private final Map<String, Entry> byHash = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    AgentTokens(UserData users, Path dataDir, int maxDays) throws IOException {
        this.users = users;
        this.usersDir = dataDir.resolve("users");
        this.maxDays = Math.max(1, maxDays);
        if (Files.isDirectory(usersDir)) {
            try (Stream<Path> s = Files.list(usersDir)) {
                for (Path dir : (Iterable<Path>) s::iterator) {
                    Path f = dir.resolve(FILE);
                    if (Files.isRegularFile(f)) {
                        for (Entry e : read(f)) {
                            byHash.put(e.hash, e);
                        }
                    }
                }
            }
        }
    }

    int maxDays() {
        return maxDays;
    }

    /** The owner of a presented token, when it is one of ours and not expired; null otherwise. */
    Entry find(String token) {
        if (token == null || !token.startsWith(PREFIX)) {
            return null;
        }
        Entry e = byHash.get(hash(token));
        if (e == null || Instant.now().isAfter(e.expires)) {
            return null;
        }
        // last used, kept to the minute and written at most every ten minutes
        Instant now = Instant.now().truncatedTo(ChronoUnit.MINUTES);
        if (e.lastUsed == null || e.lastUsed.isBefore(now.minus(10, ChronoUnit.MINUTES))) {
            Entry u = e.used(now);
            byHash.put(u.hash, u);
            save(u.who.subject);
        }
        return byHash.get(e.hash);
    }

    /** A new token for {@code who}; the only time its value is seen. */
    synchronized Map<String, Object> create(Session.Principal who, String label, int days) {
        String l = label == null || label.isBlank() ? "agent" : label.trim();
        if (l.length() > 60) {
            throw new TreeService.BadRequest("a label is at most 60 characters");
        }
        if (byHash.values().stream().anyMatch(e -> e.who.subject.equals(who.subject) && e.label.equals(l))) {
            throw new TreeService.BadRequest("you already have a token called '" + l + "'; revoke it or pick another label");
        }
        int d = days <= 0 ? Math.min(DEFAULT_DAYS, maxDays) : days;
        if (d > maxDays) {
            throw new TreeService.BadRequest("a token lasts at most " + maxDays + " days on this server");
        }
        byte[] raw = new byte[32];
        random.nextBytes(raw);
        String token = PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Entry e = new Entry(Long.toHexString(random.nextLong() & Long.MAX_VALUE), l, hash(token), now, now.plus(d, ChronoUnit.DAYS), null, who);
        byHash.put(e.hash, e);
        save(who.subject);
        Map<String, Object> m = view(e);
        m.put("token", token);
        return m;
    }

    synchronized boolean revoke(Session.Principal who, String id) {
        boolean removed = byHash.values().removeIf(e -> e.who.subject.equals(who.subject) && e.id.equals(id));
        if (removed) {
            save(who.subject);
        }
        return removed;
    }

    List<Map<String, Object>> list(Session.Principal who) {
        List<Map<String, Object>> out = new ArrayList<>();
        byHash.values().stream().filter(e -> e.who.subject.equals(who.subject)).sorted((a, b) -> a.created.compareTo(b.created)).forEach(e -> out.add(view(e)));
        return out;
    }

    /** The person used the page: their tokens act with who they are now (name, groups, roles). */
    synchronized void refresh(Session.Principal who) {
        boolean changed = false;
        for (Entry e : new ArrayList<>(byHash.values())) {
            if (e.who.subject.equals(who.subject) && !same(e.who, who)) {
                byHash.put(e.hash, e.as(who));
                changed = true;
            }
        }
        if (changed) {
            save(who.subject);
        }
    }

    private static boolean same(Session.Principal a, Session.Principal b) {
        return java.util.Objects.equals(a.name, b.name) && java.util.Objects.equals(a.email, b.email) && a.groups.equals(b.groups)
            && a.editor == b.editor && a.deployer == b.deployer;
    }

    private static Map<String, Object> view(Entry e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.id);
        m.put("label", e.label);
        m.put("created", e.created.toString());
        m.put("expires", e.expires.toString());
        m.put("lastUsed", e.lastUsed == null ? null : e.lastUsed.toString());
        m.put("expired", Instant.now().isAfter(e.expires));
        return m;
    }

    // ---- the file ----

    private synchronized void save(String subject) {
        List<Object> list = new ArrayList<>();
        Session.Principal who = null;
        for (Entry e : byHash.values()) {
            if (!e.who.subject.equals(subject)) {
                continue;
            }
            who = e.who;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.id);
            m.put("label", e.label);
            m.put("sha256", e.hash);
            m.put("created", e.created.toString());
            m.put("expires", e.expires.toString());
            m.put("lastUsed", e.lastUsed == null ? null : e.lastUsed.toString());
            m.put("subject", e.who.subject);
            m.put("name", e.who.name);
            m.put("email", e.who.email);
            m.put("groups", e.who.groups);
            m.put("editor", e.who.editor);
            m.put("deployer", e.who.deployer);
            list.add(m);
        }
        try {
            Path dir = who != null ? users.dir(who) : usersDir.resolve(Workspaces.safe(subject));
            Path f = dir.resolve(FILE);
            if (list.isEmpty()) {
                Files.deleteIfExists(f);
                return;
            }
            Files.writeString(f, Json.pretty(Map.of("tokens", list)) + "\n", StandardCharsets.UTF_8);
            PropertiesFile.ownerOnly(f);
        } catch (IOException e) {
            System.err.println("agent tokens: cannot write for " + subject + ": " + e.getMessage());
        }
    }

    private static List<Entry> read(Path f) throws IOException {
        List<Entry> out = new ArrayList<>();
        for (Object o : Json.asList(Json.asMap(Json.parse(Files.readString(f, StandardCharsets.UTF_8))).get("tokens"))) {
            Map<String, Object> m = Json.asMap(o);
            List<String> groups = new ArrayList<>();
            for (Object g : Json.asList(m.get("groups"))) {
                groups.add(String.valueOf(g));
            }
            Session.Principal who = new Session.Principal(Json.asString(m.get("subject")), Json.asString(m.get("name")), Json.asString(m.get("email")),
                groups, Boolean.TRUE.equals(m.get("editor")), Boolean.TRUE.equals(m.get("deployer")));
            String used = Json.asString(m.get("lastUsed"));
            out.add(new Entry(Json.asString(m.get("id")), Json.asString(m.get("label")), Json.asString(m.get("sha256")),
                Instant.parse(Json.asString(m.get("created"))), Instant.parse(Json.asString(m.get("expires"))), used == null ? null : Instant.parse(used), who));
        }
        return out;
    }

    static String hash(String token) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : h) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
