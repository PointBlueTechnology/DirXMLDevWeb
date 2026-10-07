package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * One JSON line per thing a person did: when, who, which workspace and branch, what, with
 * what arguments (never file contents or secret values), and how it went. Hosted mode writes
 * {@code audit.log} in its data directory; local mode has no file and the calls are no-ops.
 */
public final class Audit {

    private final Path file;

    public Audit(Path file) {
        this.file = file;
    }

    public static Audit none() {
        return new Audit(null);
    }

    /**
     * The last {@code limit} lines that match: {@code since} (ISO instant, or null), {@code user}
     * (subject), {@code project}, {@code event} (substring) — newest first. Lines keep what the
     * writer kept: names and flags, never contents or secrets.
     */
    public synchronized List<Map<String, Object>> read(String since, String user, String project, String event, int limit) throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        if (file == null || !Files.exists(file)) {
            return out;
        }
        List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        for (int i = lines.size() - 1; i >= 0 && out.size() < Math.max(1, limit); i--) {
            String line = lines.get(i).trim();
            if (line.isEmpty()) {
                continue;
            }
            Map<String, Object> m;
            try {
                m = com.pointblue.dirxml.dev.json.Json.asMap(com.pointblue.dirxml.dev.json.Json.parse(line));
            } catch (RuntimeException e) {
                continue;
            }
            if (since != null && !since.isBlank() && String.valueOf(m.get("time")).compareTo(since) < 0) {
                break;   // older than asked: the file is in time order
            }
            if (user != null && !user.isBlank() && !user.equals(m.get("user"))) {
                continue;
            }
            if (project != null && !project.isBlank() && !project.equals(m.get("project"))) {
                continue;
            }
            if (event != null && !event.isBlank() && !String.valueOf(m.get("event")).contains(event)) {
                continue;
            }
            out.add(m);
        }
        return out;
    }

    public synchronized void log(Session session, Workspace ws, String event, Map<String, Object> details, String outcome) {
        if (file == null) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("time", Instant.now().toString());
        m.put("user", session == null ? null : session.principal.subject);
        m.put("workspace", ws == null ? null : ws.id);
        m.put("project", ws == null || ws.id.indexOf('/') < 0 ? null : ws.id.substring(0, ws.id.indexOf('/')));
        m.put("branch", ws == null ? null : ws.branch);
        m.put("event", event);
        m.put("details", details == null ? Map.of() : details);
        m.put("outcome", outcome);
        try {
            if (file.getParent() != null) {
                Files.createDirectories(file.getParent());
            }
            Files.writeString(file, com.pointblue.dirxml.dev.json.Json.compact(m) + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            PropertiesFile.ownerOnly(file);
        } catch (IOException e) {
            System.err.println("audit: cannot write " + file + ": " + e.getMessage());
        }
    }
}
