package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import com.pointblue.dirxml.dev.ReleaseCheck;
import java.nio.file.Path;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** #126: the page hears of a newer release from the day's cached answer; never when current, never when off. */
public class WebReleaseCheckTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private Path cache(String latest, long checkedAt) throws Exception {
        Path f = tmp.newFolder().toPath().resolve("release-check.json");
        ReleaseCheck.Cache c = new ReleaseCheck.Cache();
        c.latest = latest;
        c.url = "https://github.com/PointBlueTechnology/DirXMLDevWeb/releases/tag/v" + latest;
        c.checkedAt = checkedAt;
        ReleaseCheck.writeCache(f, c);
        return f;
    }

    @Test
    public void aNewerReleaseIsReportedFromTheCache() throws Exception {
        Path f = cache("0.70.0", System.currentTimeMillis());
        // an unreachable URL: a stale cache's refresh would fail quietly, never block
        WebReleaseCheck check = new WebReleaseCheck(f, "0.66.0", "http://127.0.0.1:1/latest", null, Map.of());
        Map<String, Object> m = check.newer();
        assertEquals("0.70.0", m.get("version"));
        assertNull(new WebReleaseCheck(f, "0.70.0", "http://127.0.0.1:1/latest", null, Map.of()).newer());
        assertNull(new WebReleaseCheck(f, "0.71.0", "http://127.0.0.1:1/latest", null, Map.of()).newer());
        assertNull("off", new WebReleaseCheck(f, "0.66.0", "http://127.0.0.1:1/latest", "release.check=false", Map.of()).newer());
    }

    @Test
    public void aFailedRefreshKeepsTheLastAnswer() throws Exception {
        Path f = cache("0.70.0", 1);
        WebReleaseCheck check = new WebReleaseCheck(f, "0.66.0", "http://127.0.0.1:1/latest", null, Map.of());
        check.refresh();
        ReleaseCheck.Cache c = ReleaseCheck.readCache(f);
        assertEquals("0.70.0", c.latest);
        assertEquals(true, c.checkedAt > 1);
    }
}
