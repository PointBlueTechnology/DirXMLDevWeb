package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Edits to a properties file that keep its other lines (comments, order, blank lines) as they
 * are: set a key, remove a key, and save the file readable by its owner only. Two dialects, as
 * the core reads them: the environments file is a {@link java.util.Properties} file (a key ends
 * at the first unescaped {@code =}, {@code :} or space; a backslash in a value is escaped), and a
 * secrets file is raw {@code key=value} lines split at the first {@code =}, both sides trimmed,
 * no escaping (keys hold driver names with spaces, values hold passwords with backslashes).
 */
final class PropertiesFile {

    private final Path file;
    private final boolean raw;
    private final List<String> lines = new ArrayList<>();

    PropertiesFile(Path file) throws IOException {
        this(file, false);
    }

    PropertiesFile(Path file, boolean raw) throws IOException {
        this.file = file;
        this.raw = raw;
        if (Files.isRegularFile(file)) {
            lines.addAll(Files.readAllLines(file, StandardCharsets.UTF_8));
        }
    }

    Path file() {
        return file;
    }

    /** The key of a line, or null for a comment, a blank line or a continuation. */
    static String keyOf(String line, boolean raw) {
        String t = line.stripLeading();
        if (t.isEmpty() || t.startsWith("#") || t.startsWith("!")) {
            return null;
        }
        if (raw) {
            int eq = t.indexOf('=');
            return eq <= 0 ? null : t.substring(0, eq).strip();
        }
        int i = 0;
        while (i < t.length() && "=: \t".indexOf(t.charAt(i)) < 0) {
            if (t.charAt(i) == '\\') {
                i++;
            }
            i++;
        }
        return t.substring(0, Math.min(i, t.length()));
    }

    static String escape(String value, boolean raw) {
        if (raw) {
            return value.strip();
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\\' || (i == 0 && c == ' ')) {
                sb.append('\\');
            }
            if (c == '\n') {
                sb.append("\\n");
            } else if (c == '\r') {
                sb.append("\\r");
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /** Set the key's value, replacing an existing line in place or appending; null removes it. */
    void set(String key, String value) {
        String line = value == null ? null : key + "=" + escape(value, raw);
        boolean done = false;
        for (int i = 0; i < lines.size(); i++) {
            if (key.equals(keyOf(lines.get(i), raw))) {
                if (line == null || done) {
                    lines.remove(i--);
                } else {
                    lines.set(i, line);
                    done = true;
                }
            }
        }
        if (line != null && !done) {
            lines.add(line);
        }
    }

    void remove(String key) {
        set(key, null);
    }

    /** Every key present, with the raw value text. */
    Map<String, String> entries() {
        Map<String, String> out = new LinkedHashMap<>();
        for (String l : lines) {
            String k = keyOf(l, raw);
            if (k != null) {
                String t = l.strip();
                String rest = raw ? t.substring(t.indexOf('=') + 1).strip() : t.substring(k.length()).stripLeading();
                if (!raw && !rest.isEmpty() && "=:".indexOf(rest.charAt(0)) >= 0) {
                    rest = rest.substring(1).stripLeading();
                }
                out.put(k, rest);
            }
        }
        return out;
    }

    /** Write the file, creating its directory, readable and writable by the owner only. */
    void save() throws IOException {
        if (file.getParent() != null) {
            Files.createDirectories(file.getParent());
        }
        Files.writeString(file, String.join("\n", lines) + (lines.isEmpty() ? "" : "\n"), StandardCharsets.UTF_8);
        ownerOnly(file);
    }

    static void ownerOnly(Path file) {
        try {
            Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException | IOException e) {
            // not a POSIX file system: nothing to tighten
        }
    }
}
