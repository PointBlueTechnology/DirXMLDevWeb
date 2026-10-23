package com.pointblue.dirxml.web;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * One JSON line per thing a person did: when, who, which workspace and branch, what, with
 * what arguments (never file contents or secret values), and how it went. Hosted mode writes
 * {@code audit.log} in its data directory; local mode has no file and the calls are no-ops.
 *
 * <p>Rotated by size (#161): a line that would take {@code audit.log} past {@code maxBytes} first moves it to
 * {@code audit.log.1}, the older ones up by one ({@code .1} to {@code .2} …), and the ones past {@code keep} are
 * deleted; {@code keep} 0 deletes none, {@code maxBytes} 0 never rotates. A line is never split between files.
 * Reading goes from the newest line backwards, file by file, and stops as soon as it has enough.
 */
public final class Audit {

    /** {@code audit.maxBytes} and {@code audit.keep} when the configuration doesn't say: about 110 MB in all. */
    public static final long DEFAULT_MAX_BYTES = 10L * 1024 * 1024;
    public static final int DEFAULT_KEEP = 10;

    private final Path file;
    private final long maxBytes;
    private final int keep;

    public Audit(Path file) {
        this(file, DEFAULT_MAX_BYTES, DEFAULT_KEEP);
    }

    public Audit(Path file, long maxBytes, int keep) {
        this.file = file;
        this.maxBytes = maxBytes;
        this.keep = keep;
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
        if (file == null) {
            return out;
        }
        Instant from = since == null || since.isBlank() ? null : since(since);
        // the current file, then .1, .2 …: newest to oldest, each in time order
        List<Path> files = new ArrayList<>();
        files.add(file);
        for (int n : rotated()) {
            files.add(rotated(n));
        }
        for (Path f : files) {
            if (!Files.exists(f)) {
                continue;
            }
            try (Backwards lines = new Backwards(f)) {
                for (String raw = lines.next(); raw != null; raw = lines.next()) {
                    if (out.size() >= Math.max(1, limit)) {
                        return out;
                    }
                    String line = raw.trim();
                    if (line.isEmpty()) {
                        continue;
                    }
                    Map<String, Object> m;
                    try {
                        m = com.pointblue.dirxml.dev.json.Json.asMap(com.pointblue.dirxml.dev.json.Json.parse(line));
                    } catch (RuntimeException e) {
                        continue;
                    }
                    Instant at = instant(String.valueOf(m.get("time")));
                    if (from != null && at != null && at.isBefore(from)) {
                        return out;   // older than asked: the files are in time order
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
            }
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
        if (session != null && session.via != null) {
            m.put("via", session.via);   // an agent acting for the person, by its token's label
        }
        m.put("workspace", ws == null ? null : ws.id);
        m.put("project", ws == null || ws.id.indexOf('/') < 0 ? null : ws.id.substring(0, ws.id.indexOf('/')));
        m.put("branch", ws == null ? null : ws.branch);
        m.put("event", event);
        m.put("details", details == null ? Map.of() : details);
        m.put("outcome", outcome);
        byte[] line = (com.pointblue.dirxml.dev.json.Json.compact(m) + "\n").getBytes(StandardCharsets.UTF_8);
        try {
            if (file.getParent() != null) {
                Files.createDirectories(file.getParent());
            }
            if (maxBytes > 0 && Files.exists(file) && Files.size(file) > 0 && Files.size(file) + line.length > maxBytes) {
                rotate();
            }
            Files.write(file, line, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            PropertiesFile.ownerOnly(file);
        } catch (IOException e) {
            System.err.println("audit: cannot write " + file + ": " + e.getMessage());
        }
    }

    /**
     * A line's time, compared as a time: Instant.toString writes 3, 6 or 9 fraction digits as needed, so the
     * strings don't sort (".123Z" after ".123456Z").
     */
    static Instant instant(String s) {
        try {
            return Instant.parse(s.trim());
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * The {@code since} filter, in UTC: a whole instant, or the start of one as the page's box is typed
     * ({@code 2026-10}, {@code 2026-10-07T09:30}), completed with the earliest values; null (no filter) when it
     * doesn't read as either.
     */
    static Instant since(String s) {
        String t = s.trim();
        Instant whole = instant(t);
        if (whole != null) {
            return whole;
        }
        String bare = t.endsWith("Z") || t.endsWith("z") ? t.substring(0, t.length() - 1) : t;
        String template = "0000-01-01T00:00:00";
        if (bare.length() < 4 || bare.length() > template.length()) {
            return null;
        }
        return instant(bare + template.substring(bare.length()) + "Z");
    }

    /** audit.log to .1, the rest up by one, and none kept past {@code keep} (when it is set). */
    private void rotate() throws IOException {
        TreeSet<Integer> old = rotated();
        if (keep > 0) {
            for (int n : new ArrayList<>(old)) {
                if (n >= keep) {
                    Files.deleteIfExists(rotated(n));   // it would move past keep
                    old.remove(n);
                }
            }
        }
        for (int n : old.descendingSet()) {
            Files.move(rotated(n), rotated(n + 1), StandardCopyOption.REPLACE_EXISTING);
        }
        Files.move(file, rotated(1), StandardCopyOption.REPLACE_EXISTING);
    }

    private Path rotated(int n) {
        return file.resolveSibling(file.getFileName() + "." + n);
    }

    /** The numbers of the rotated files there are (audit.log.1, .2 …), lowest first. */
    private TreeSet<Integer> rotated() throws IOException {
        TreeSet<Integer> out = new TreeSet<>();
        Path dir = file.toAbsolutePath().getParent();
        if (dir == null || !Files.isDirectory(dir)) {
            return out;
        }
        String prefix = file.getFileName() + ".";
        try (var list = Files.list(dir)) {
            list.forEach(p -> {
                String name = p.getFileName().toString();
                if (name.startsWith(prefix) && name.substring(prefix.length()).matches("[1-9][0-9]{0,5}")) {
                    out.add(Integer.parseInt(name.substring(prefix.length())));
                }
            });
        }
        return out;
    }

    /** A file's lines from the last to the first, read from the end in blocks: only as much as is asked for. */
    static final class Backwards implements AutoCloseable {

        private static final int BLOCK = 64 * 1024;
        private final RandomAccessFile in;
        private long pos;
        private byte[] buf = new byte[0];
        private int end;   // buf[0 .. end) is read and not yet returned

        Backwards(Path f) throws IOException {
            in = new RandomAccessFile(f.toFile(), "r");
            pos = in.length();
        }

        /** The next line going backwards, without its newline; null at the start of the file. */
        String next() throws IOException {
            while (true) {
                for (int i = end - 1; i >= 0; i--) {
                    if (buf[i] == '\n') {
                        String line = new String(buf, i + 1, end - i - 1, StandardCharsets.UTF_8);
                        end = i;
                        return line;   // after the file's last newline this is "", which readers skip
                    }
                }
                if (pos == 0) {
                    if (end == 0) {
                        return null;
                    }
                    String line = new String(buf, 0, end, StandardCharsets.UTF_8);
                    end = 0;
                    return line;
                }
                int n = (int) Math.min(BLOCK, pos);
                pos -= n;
                byte[] more = new byte[n + end];
                in.seek(pos);
                in.readFully(more, 0, n);
                System.arraycopy(buf, 0, more, n, end);
                buf = more;
                end = n + end;
            }
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }
}
