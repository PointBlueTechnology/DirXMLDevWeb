package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.ReleaseCheck;
import com.pointblue.dirxml.dev.Version;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * #126: is a newer DirXMLDevWeb out? Asked of GitHub at most once a day, in the background (a page never waits on it),
 * the answer kept in the server's data folder; the page shows a quiet note in its top bar. Off with
 * {@code release.check=false} in hosted.properties or {@code IDMWEB_NO_UPDATE_CHECK} (an air-gapped server, CI).
 * The core's {@link ReleaseCheck} does the asking, the parsing and the cache file.
 */
final class WebReleaseCheck {

    static final String REPO = "PointBlueTechnology/DirXMLDevWeb";
    static final String LATEST_URL = "https://api.github.com/repos/" + REPO + "/releases/latest";
    static final String OFF_ENV = "IDMWEB_NO_UPDATE_CHECK";

    private final Path cache;
    private final String current;
    private final String url;
    private final String offReason;
    private final Map<String, String> env;
    private volatile boolean refreshing;

    WebReleaseCheck(Path cache, String current, String url, String offReason, Map<String, String> env) {
        this.cache = cache;
        this.current = current;
        this.url = url;
        this.offReason = offReason;
        this.env = env;
    }

    /** The check for this server: the cache in its data folder (hosted) or under ~/.idm (local mode). */
    static WebReleaseCheck of(Workspaces workspaces, String current) {
        Map<String, String> env = System.getenv();
        Hosted h = workspaces.config();
        String off = null;
        if (env.get(OFF_ENV) != null && !env.get(OFF_ENV).isBlank()) {
            off = OFF_ENV + " is set";
        } else if (env.get("CI") != null && !env.get("CI").isBlank()) {
            off = "CI is set";
        } else if (h != null && "false".equalsIgnoreCase(h.props.getProperty("release.check", "true").trim())) {
            off = "release.check=false";
        }
        Path cache = h != null ? h.dataDir.resolve("release-check.json")
            : Path.of(System.getProperty("user.home"), ".idm", "web-release-check.json");
        return new WebReleaseCheck(cache, current, LATEST_URL, off, env);
    }

    /**
     * The newer release ({@code version}, {@code url}) the last check found, or null: none newer, none known yet, or
     * the check is off. A stale answer starts a refresh in the background and is used meanwhile.
     */
    Map<String, Object> newer() {
        if (offReason != null) {
            return null;
        }
        ReleaseCheck.Cache c = ReleaseCheck.readCache(cache);
        if (!c.fresh(System.currentTimeMillis())) {
            refreshInBackground();
        }
        if (c.latest == null || current == null || Version.compare(current, c.latest) >= 0) {
            return null;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("version", c.latest);
        m.put("url", c.url);
        return m;
    }

    private void refreshInBackground() {
        if (refreshing) {
            return;
        }
        refreshing = true;
        Thread t = new Thread(() -> {
            try {
                refresh();
            } finally {
                refreshing = false;
            }
        }, "release-check");
        t.setDaemon(true);
        t.start();
    }

    /** Ask now and keep the answer (a failure keeps the last answer, and is asked again tomorrow). */
    void refresh() {
        ReleaseCheck.Cache c = ReleaseCheck.readCache(cache);
        ReleaseCheck.Latest l = ReleaseCheck.latest(url, env);
        c.checkedAt = System.currentTimeMillis();
        if (l != null) {
            c.latest = l.version;
            c.url = l.url;
        }
        ReleaseCheck.writeCache(cache, c);
    }
}
