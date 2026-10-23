package com.pointblue.dirxml.web;

import com.pointbluetech.dirxml.trace.model.Channel;
import com.pointbluetech.dirxml.trace.model.TraceFileReader;
import com.pointbluetech.dirxml.trace.model.TraceFileWriter;
import com.pointbluetech.dirxml.trace.model.TraceRecord;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Trace files of one workspace (features.md, Trace files): recordings the live stream writes and
 * files people upload, kept per project under the data directory. A file is parsed once with the
 * viewer library's reader into an index the page reads in pages, filtered on the server, so a
 * large file never travels whole. One parsed file is kept in memory at a time.
 */
public final class TraceFiles {
    public static final long DEFAULT_LIMIT = 1024L * 1024 * 1024;
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._ -]{0,119}(/[A-Za-z0-9][A-Za-z0-9._ -]{0,119})?");
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneId.systemDefault());

    private final Path dir;
    private final long limit;
    private Parsed parsed;   // the one file held parsed

    public TraceFiles(Path dir) {
        this(dir, DEFAULT_LIMIT);
    }

    public TraceFiles(Path dir, long limit) {
        this.dir = dir;
        this.limit = limit;
    }

    public Path dir() {
        return dir;
    }

    /** A file's path under the directory; refuses a name that could leave it. */
    public Path path(String name) {
        if (name == null || !NAME.matcher(name).matches()) {
            throw new TreeService.BadRequest("a trace file name is letters, digits, '.', '_', '-' and spaces, with one '/' at most");
        }
        Path p = dir.resolve(name).normalize();
        if (!p.startsWith(dir)) {
            throw new TreeService.BadRequest("a trace file name stays in its directory");
        }
        return p;
    }

    /** Every file, newest first: name, bytes, modified. */
    public synchronized List<Map<String, Object>> list() throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!Files.isDirectory(dir)) {
            return out;
        }
        try (Stream<Path> s = Files.walk(dir, 2)) {
            List<Path> files = s.filter(Files::isRegularFile).filter(p -> !p.getFileName().toString().startsWith(".")).sorted(Comparator.comparingLong((Path p) -> {
                try {
                    return Files.getLastModifiedTime(p).toMillis();
                } catch (IOException e) {
                    return 0L;
                }
            }).reversed()).toList();
            for (Path p : files) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("name", dir.relativize(p).toString().replace('\\', '/'));
                m.put("bytes", Files.size(p));
                m.put("modified", Files.getLastModifiedTime(p).toInstant().toString());
                m.put("parsed", parsed != null && parsed.path.equals(p));
                out.add(m);
            }
        }
        return out;
    }

    /** A writer for a recording of the live stream: {@code <env>/<driver or all>-<time>.trace}. */
    public synchronized TraceFileWriter record(String env, String driver) throws IOException {
        String base = (driver == null || driver.isBlank() ? "all" : driver).replaceAll("[^A-Za-z0-9._-]+", "-");
        String name = safeDir(env) + "/" + base + "-" + STAMP.format(Instant.now()) + ".trace";
        Path p = path(name);
        Files.createDirectories(p.getParent());
        return new TraceFileWriter(p, false);
    }

    private static String safeDir(String env) {
        String s = env == null ? "trace" : env.replaceAll("[^A-Za-z0-9._-]+", "-");
        return s.isEmpty() ? "trace" : s;
    }

    /** Stores an uploaded file (the whole body), refusing one over the limit; the stored name is returned. */
    public synchronized String upload(String name, InputStream body, long declaredLength) throws IOException {
        if (declaredLength > limit) {
            throw new TreeService.BadRequest("the file is " + declaredLength + " bytes; the limit is " + limit + " (traces.maxBytes)");
        }
        String base = name == null || name.isBlank() ? "upload-" + STAMP.format(Instant.now()) + ".trace" : name.trim().replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._ -]+", "-");
        if (base.isEmpty() || base.startsWith(".")) {
            base = "upload-" + STAMP.format(Instant.now()) + ".trace";
        }
        String stored = "uploads/" + base;
        Path p = path(stored);
        Files.createDirectories(p.getParent());
        Path tmp = Files.createTempFile(p.getParent(), ".up-", ".part");
        long n = 0;
        try (OutputStream out = Files.newOutputStream(tmp)) {
            byte[] buf = new byte[1 << 16];
            int r;
            while ((r = body.read(buf)) > 0) {
                n += r;
                if (n > limit) {
                    throw new TreeService.BadRequest("the file is over the limit of " + limit + " bytes (traces.maxBytes)");
                }
                out.write(buf, 0, r);
            }
            Files.move(tmp, p, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(tmp);
        }
        if (parsed != null && parsed.path.equals(p)) {
            parsed = null;
        }
        return stored;
    }

    public synchronized void delete(String name) throws IOException {
        Path p = path(name);
        if (!Files.deleteIfExists(p)) {
            throw new TreeService.NotFound("no trace file " + name);
        }
        if (parsed != null && parsed.path.equals(p)) {
            parsed = null;
        }
    }

    /** The parsed file (parsed now if it is not the one held). */
    synchronized Parsed open(String name) throws IOException {
        Path p = path(name);
        if (!Files.isRegularFile(p)) {
            throw new TreeService.NotFound("no trace file " + name);
        }
        long modified = Files.getLastModifiedTime(p).toMillis();
        if (parsed == null || !parsed.path.equals(p) || parsed.modified != modified) {
            if (Files.size(p) > limit) {
                throw new TreeService.BadRequest("the file is over the limit of " + limit + " bytes (traces.maxBytes)");
            }
            List<TraceRecord> records = new ArrayList<>();
            TraceFileReader.read(p, records::add, bytes -> { }, () -> true);
            // fold regions over the whole file, once, so every page and filter sees the same ids
            com.pointbluetech.dirxml.trace.model.TraceFolds folds = new com.pointbluetech.dirxml.trace.model.TraceFolds();
            List<com.pointbluetech.dirxml.trace.model.TraceFolds.Placement> places = new ArrayList<>(records.size());
            for (TraceRecord r : records) {
                places.add(folds.add(r));
            }
            parsed = new Parsed(p, modified, records, places);
        }
        return parsed;
    }

    /**
     * A page of a file's records after the filters: {@code from} and {@code count} over the
     * matching records; the total of matches and of the file come along.
     */
    public Map<String, Object> records(String name, int from, int count, Set<Channel> channels, String driver, String text) throws IOException {
        Parsed p = open(name);
        List<Object> out = new ArrayList<>();
        int matched = 0;
        String needle = text == null || text.isBlank() ? null : text.toLowerCase(Locale.ROOT);
        String drv = driver == null || driver.isBlank() ? null : driver;
        int max = Math.max(1, Math.min(count, 50_000));
        for (int i = 0; i < p.records.size(); i++) {
            TraceRecord r = p.records.get(i);
            if (channels != null && !channels.contains(r.channel())) {
                continue;
            }
            if (drv != null && (r.driverName() == null || !r.driverName().equalsIgnoreCase(drv))) {
                continue;
            }
            if (needle != null && !r.text().toLowerCase(Locale.ROOT).contains(needle)) {
                continue;
            }
            if (matched >= from && out.size() < max) {
                out.add(TraceService.json(r, p.places.get(i)));
            }
            matched++;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("from", from);
        m.put("count", out.size());
        m.put("matched", matched);
        m.put("total", p.records.size());
        m.put("drivers", p.drivers());
        m.put("records", out);
        return m;
    }

    static final class Parsed {
        final Path path;
        final long modified;
        final List<TraceRecord> records;
        /** Each record's fold placement, parallel to {@link #records}. */
        final List<com.pointbluetech.dirxml.trace.model.TraceFolds.Placement> places;
        private List<String> drivers;

        Parsed(Path path, long modified, List<TraceRecord> records, List<com.pointbluetech.dirxml.trace.model.TraceFolds.Placement> places) {
            this.path = path;
            this.modified = modified;
            this.records = records;
            this.places = places;
        }

        List<String> drivers() {
            if (drivers == null) {
                java.util.TreeSet<String> names = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
                for (TraceRecord r : records) {
                    if (r.driverName() != null) {
                        names.add(r.driverName());
                    }
                }
                drivers = new ArrayList<>(names);
            }
            return drivers;
        }
    }

    /** {@code S,P,V,O} letters → channels; null = every channel. */
    public static Set<Channel> channels(String letters) {
        if (letters == null || letters.isBlank()) {
            return null;
        }
        Set<Channel> out = java.util.EnumSet.noneOf(Channel.class);
        for (char c : letters.toUpperCase(Locale.ROOT).toCharArray()) {
            switch (c) {
                case 'S' -> out.add(Channel.SUBSCRIBER);
                case 'P' -> out.add(Channel.PUBLISHER);
                case 'V' -> out.add(Channel.SERVICE);
                case 'O' -> out.add(Channel.OTHER);
                default -> { }
            }
        }
        return out;
    }
}
