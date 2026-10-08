package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.pointbluetech.dirxml.trace.model.Channel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class TraceFilesTest {
    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static final String TRACE = "[10/07/26 11:15:11.244]:AD ST:Applying policy: NOVLADDCFG-sub-ctp-X.\n"
        + "[10/07/26 11:15:11.250]:AD ST:\n<nds dtdversion=\"4.0\">\n  <input/>\n</nds>\n"
        + "[10/07/26 11:15:12.000]:Loop PT:Received state change event.\n"
        + "[10/07/26 11:15:13.000]:AD ST:<status level=\"error\">bad</status>\n";

    @Test
    public void namesStayInTheDirectoryAndUploadsAreListedAndPaged() throws Exception {
        Path dir = tmp.newFolder("traces").toPath();
        TraceFiles t = new TraceFiles(dir, 10_000);
        String stored = t.upload("../../etc/passwd", new java.io.ByteArrayInputStream(TRACE.getBytes(StandardCharsets.UTF_8)), TRACE.length());
        assertEquals("uploads/passwd", stored);
        assertTrue(Files.isRegularFile(dir.resolve("uploads/passwd")));
        List<Map<String, Object>> files = t.list();
        assertEquals(1, files.size());
        assertEquals("uploads/passwd", files.get(0).get("name"));
        Map<String, Object> all = t.records(stored, 0, 100, null, null, null);
        assertEquals(4, all.get("total"));
        assertEquals(4, all.get("matched"));
        assertEquals(List.of("AD", "Loop"), all.get("drivers"));
        Map<String, Object> ad = t.records(stored, 0, 100, null, "ad", null);
        assertEquals(3, ad.get("matched"));
        Map<String, Object> pub = t.records(stored, 0, 100, TraceFiles.channels("P"), null, null);
        assertEquals(1, pub.get("matched"));
        Map<String, Object> text = t.records(stored, 0, 100, null, null, "ERROR");
        assertEquals(1, text.get("matched"));
        Map<String, Object> page = t.records(stored, 1, 2, null, null, null);
        assertEquals(2, page.get("count"));
        assertEquals(4, page.get("matched"));
        for (String bad : List.of("", "../x", "a/b/c", ".hidden")) {
            try {
                t.path(bad);
                throw new AssertionError("accepted " + bad);
            } catch (TreeService.BadRequest expected) {
                // refused
            }
        }
        t.delete(stored);
        assertFalse(Files.exists(dir.resolve("uploads/passwd")));
    }

    @Test
    public void theLimitIsEnforcedAndARecordingHasItsName() throws Exception {
        Path dir = tmp.newFolder("traces2").toPath();
        TraceFiles t = new TraceFiles(dir, 10);
        try {
            t.upload("big.trace", new java.io.ByteArrayInputStream(TRACE.getBytes(StandardCharsets.UTF_8)), -1);
            throw new AssertionError("accepted");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("limit"));
        }
        assertTrue(t.list().isEmpty());
        try (com.pointbluetech.dirxml.trace.model.TraceFileWriter w = new TraceFiles(dir).record("edir3", "AD Driver")) {
            String name = dir.relativize(w.path()).toString().replace('\\', '/');
            assertTrue(name, name.startsWith("edir3/AD-Driver-") && name.endsWith(".trace"));
        }
        assertEquals(Channel.SUBSCRIBER, TraceFiles.channels("s").iterator().next());
        assertTrue(TraceFiles.channels(null) == null);
    }
}
