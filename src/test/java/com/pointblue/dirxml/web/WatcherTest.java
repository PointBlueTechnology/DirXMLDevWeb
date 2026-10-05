package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The revision moves when the tree's content moves, and only then. */
public class WatcherTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void revisionFollowsContentAndIgnoresGitAndSnapshots() throws Exception {
        Path tree = tmp.newFolder("tree").toPath();
        Files.writeString(tree.resolve("driverset.xml"), "<driverset/>", StandardCharsets.UTF_8);
        String r0 = Watcher.signature(tree);
        assertEquals("stable when nothing changes", r0, Watcher.signature(tree));

        Files.createDirectories(tree.resolve(".git"));
        Files.writeString(tree.resolve(".git/HEAD"), "ref", StandardCharsets.UTF_8);
        Files.createDirectories(tree.resolve("deploy-snapshots/stg"));
        Files.writeString(tree.resolve("deploy-snapshots/stg/a.ldif"), "dn: x", StandardCharsets.UTF_8);
        assertEquals("git and snapshots are not content", r0, Watcher.signature(tree));

        Files.createDirectories(tree.resolve("drivers/AD"));
        Files.writeString(tree.resolve("drivers/AD/driver.xml"), "<driver/>", StandardCharsets.UTF_8);
        String r1 = Watcher.signature(tree);
        assertNotEquals(r0, r1);

        Files.writeString(tree.resolve("drivers/AD/driver.xml"), "<driver name=\"AD\"/>", StandardCharsets.UTF_8);
        assertNotEquals("a different size is a different revision", r1, Watcher.signature(tree));
    }

    @Test
    public void listenersHearAChangeOnce() throws Exception {
        Path tree = tmp.newFolder("tree2").toPath();
        Path f = tree.resolve("driverset.xml");
        Files.writeString(f, "<driverset/>", StandardCharsets.UTF_8);
        try (Watcher w = new Watcher(tree, 10_000)) {
            List<String> heard = new ArrayList<>();
            w.onChange(heard::add);
            assertEquals(w.revision(), w.refreshNow());
            assertEquals(0, heard.size());
            Files.writeString(f, "<driverset name=\"x\"/>", StandardCharsets.UTF_8);
            Files.setLastModifiedTime(f, FileTime.fromMillis(System.currentTimeMillis() + 2000));
            String now = w.refreshNow();
            assertEquals(List.of(now), heard);
            w.refreshNow();
            assertEquals(1, heard.size());
        }
    }
}
