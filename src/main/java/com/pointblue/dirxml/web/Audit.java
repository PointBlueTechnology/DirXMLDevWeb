package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.LinkedHashMap;
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

    public synchronized void log(Session session, Workspace ws, String event, Map<String, Object> details, String outcome) {
        if (file == null) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("time", Instant.now().toString());
        m.put("user", session == null ? null : session.principal.subject);
        m.put("workspace", ws == null ? null : ws.id);
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
