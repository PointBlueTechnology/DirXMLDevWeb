package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The audit log (#161): rotated by size, never a line split, read newest first across the files, stopping early. */
public class AuditTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static Session as(String who) {
        return new Session("s-" + who, new Session.Principal(who, who, null, List.of("idm-deployers"), true, true));
    }

    private static void write(Audit a, int from, int to) {
        for (int i = from; i < to; i++) {
            a.log(as("alice"), null, "op", Map.of("n", i), "ok");
        }
    }

    private static List<Integer> numbers(List<Map<String, Object>> entries) {
        List<Integer> out = new ArrayList<>();
        for (Map<String, Object> e : entries) {
            out.add(((Number) ((Map<?, ?>) e.get("details")).get("n")).intValue());
        }
        return out;
    }

    private static int lines(Path f) throws Exception {
        return Files.exists(f) ? Files.readAllLines(f, StandardCharsets.UTF_8).size() : 0;
    }

    @Test
    public void rotatesBeforeALineWouldPassTheLimitAndNeverSplitsOne() throws Exception {
        Path dir = tmp.newFolder("data").toPath();
        Path log = dir.resolve("audit.log");
        new Audit(log).log(as("alice"), null, "op", Map.of("n", 0), "ok");
        long one = Files.size(log);
        Files.delete(log);
        Audit a = new Audit(log, one * 3, 10);   // three lines a file
        write(a, 0, 7);
        assertEquals(1, lines(log));
        assertEquals(3, lines(dir.resolve("audit.log.1")));
        assertEquals(3, lines(dir.resolve("audit.log.2")));
        assertTrue(Files.size(log) <= one * 3 && Files.size(dir.resolve("audit.log.1")) <= one * 3);
        for (Path f : List.of(log, dir.resolve("audit.log.1"), dir.resolve("audit.log.2"))) {
            for (String l : Files.readAllLines(f, StandardCharsets.UTF_8)) {
                assertTrue("whole JSON lines only: " + l, l.startsWith("{") && l.endsWith("}"));
            }
        }
        assertEquals("newest first, across the files", List.of(6, 5, 4, 3, 2, 1, 0), numbers(a.read(null, null, null, null, 100)));
    }

    @Test
    public void keepsOnlyKeepRotatedFilesAndZeroKeepsThemAll() throws Exception {
        Path dir = tmp.newFolder("data").toPath();
        Path log = dir.resolve("audit.log");
        new Audit(log).log(as("alice"), null, "op", Map.of("n", 0), "ok");
        long one = Files.size(log);
        Files.delete(log);
        Audit two = new Audit(log, one, 2);   // one line a file, two rotated files kept
        write(two, 0, 6);
        assertTrue(Files.exists(dir.resolve("audit.log.2")));
        assertFalse("the oldest go", Files.exists(dir.resolve("audit.log.3")));
        assertEquals(List.of(5, 4, 3), numbers(two.read(null, null, null, null, 100)));

        Path dir2 = tmp.newFolder("all").toPath();
        Audit all = new Audit(dir2.resolve("audit.log"), one, 0);
        write(all, 0, 6);
        assertTrue("keep 0 deletes none", Files.exists(dir2.resolve("audit.log.5")));
        assertEquals(List.of(5, 4, 3, 2, 1, 0), numbers(all.read(null, null, null, null, 100)));

        // a lower keep later: the files past it go at the next rotation
        Audit fewer = new Audit(dir2.resolve("audit.log"), one, 2);
        write(fewer, 6, 7);
        assertFalse(Files.exists(dir2.resolve("audit.log.3")));
        assertEquals(List.of(6, 5, 4), numbers(fewer.read(null, null, null, null, 100)));
    }

    @Test
    public void zeroMaxBytesNeverRotates() throws Exception {
        Path dir = tmp.newFolder("data").toPath();
        Audit a = new Audit(dir.resolve("audit.log"), 0, 10);
        write(a, 0, 50);
        assertEquals(50, lines(dir.resolve("audit.log")));
        assertFalse(Files.exists(dir.resolve("audit.log.1")));
    }

    @Test
    public void readingStopsAtSinceAndLimitAndFilters() throws Exception {
        Path dir = tmp.newFolder("data").toPath();
        Path log = dir.resolve("audit.log");
        Audit a = new Audit(log, 400, 10);   // a few lines a file
        write(a, 0, 20);
        a.log(as("bob"), null, "deploy", Map.of("n", 20), "ok");
        assertTrue("rotated", Files.exists(dir.resolve("audit.log.2")));
        assertEquals(List.of(20, 19, 18), numbers(a.read(null, null, null, null, 3)));
        assertEquals(List.of(20), numbers(a.read(null, "bob", null, null, 100)));
        assertEquals(List.of(20), numbers(a.read(null, null, null, "deploy", 100)));
        String sinceLast = String.valueOf(a.read(null, null, null, null, 1).get(0).get("time"));
        assertTrue(numbers(a.read(sinceLast, null, null, null, 100)).contains(20));
        assertTrue("since stops before older lines", a.read("2999-01-01T00:00:00Z", null, null, null, 100).isEmpty());
        // times with 3, 6 or 9 fraction digits compare as times, not as text
        Path mixed = dir.resolve("mixed.log");
        Files.writeString(mixed, "{\"time\":\"2026-10-23T09:00:00.123Z\",\"event\":\"a\",\"details\":{\"n\":1}}\n"
            + "{\"time\":\"2026-10-23T09:00:00.123456Z\",\"event\":\"b\",\"details\":{\"n\":2}}\n", StandardCharsets.UTF_8);
        assertEquals("only the later line is at or after .1234 (as text, .123456Z sorts before .1234Z)", List.of(2), numbers(new Audit(mixed).read("2026-10-23T09:00:00.1234Z", null, null, null, 10)));
    }

    @Test
    public void readsBackwardsAcrossBlocksWithLongAndNonAsciiLines() throws Exception {
        Path f = tmp.newFile("lines").toPath();
        StringBuilder sb = new StringBuilder();
        List<String> want = new ArrayList<>();
        for (int i = 0; i < 300; i++) {
            String l = i + " " + "é€😀".repeat(i % 7) + "x".repeat((i * 997) % 3000);
            want.add(l);
            sb.append(l).append('\n');
        }
        Files.writeString(f, sb.toString(), StandardCharsets.UTF_8);
        List<String> got = new ArrayList<>();
        try (Audit.Backwards b = new Audit.Backwards(f)) {
            for (String l = b.next(); l != null; l = b.next()) {
                if (!l.isEmpty()) {
                    got.add(0, l);
                }
            }
        }
        assertEquals(want, got);
    }

    @Test
    public void concurrentWritersLoseNoLineAcrossRotations() throws Exception {
        Path dir = tmp.newFolder("data").toPath();
        Audit a = new Audit(dir.resolve("audit.log"), 2000, 0);
        List<Thread> threads = new ArrayList<>();
        for (int t = 0; t < 8; t++) {
            int base = t * 100;
            threads.add(new Thread(() -> write(a, base, base + 100)));
        }
        threads.forEach(Thread::start);
        for (Thread t : threads) {
            t.join();
        }
        List<Map<String, Object>> all = a.read(null, null, null, null, 10_000);
        Set<Integer> seen = new HashSet<>(numbers(all));
        assertEquals(800, all.size());
        assertEquals(800, seen.size());
        for (int i = 1; i < all.size(); i++) {
            assertFalse("newest first", Audit.instant(String.valueOf(all.get(i - 1).get("time"))).isBefore(Audit.instant(String.valueOf(all.get(i).get("time")))));
        }
    }

    @Test
    public void sinceTakesThePartTypedSoFar() {
        assertEquals(java.time.Instant.parse("2026-01-01T00:00:00Z"), Audit.since("2026"));
        assertEquals(java.time.Instant.parse("2026-10-01T00:00:00Z"), Audit.since("2026-10"));
        assertEquals(java.time.Instant.parse("2026-10-07T00:00:00Z"), Audit.since("2026-10-07"));
        assertEquals(java.time.Instant.parse("2026-10-07T09:30:00Z"), Audit.since("2026-10-07T09:30"));
        assertEquals(java.time.Instant.parse("2026-10-07T09:30:15.5Z"), Audit.since("2026-10-07T09:30:15.5Z"));
        assertEquals(null, Audit.since("yesterday"));
        assertEquals(null, Audit.since("20"));
    }

    @Test
    public void sizesTakeUnits() {
        assertEquals(10L * 1024 * 1024, Hosted.bytes("audit.maxBytes", "10MB"));
        assertEquals(512 * 1024, Hosted.bytes("audit.maxBytes", "512k"));
        assertEquals(2L * 1024 * 1024 * 1024, Hosted.bytes("audit.maxBytes", "2 GB"));
        assertEquals(1000, Hosted.bytes("audit.maxBytes", "1000"));
        assertEquals(0, Hosted.bytes("audit.maxBytes", "0"));
        try {
            Hosted.bytes("audit.maxBytes", "ten");
            throw new AssertionError("refused");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("audit.maxBytes"));
        }
    }
}
