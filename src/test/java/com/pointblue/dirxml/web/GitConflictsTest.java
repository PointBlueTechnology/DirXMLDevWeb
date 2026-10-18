package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Conflicts settled on the page: read (the merge undone again, nothing left half-merged), then committed with each
 * conflicting file's text; refused while conflict marks remain or when a side moved.
 */
public class GitConflictsTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    @SuppressWarnings("unchecked")
    public void aConflictIsReadThenResolvedAndCommitted() throws Exception {
        Git git = new Git(tmp.newFolder("data").toPath(), null);
        Path bare = tmp.newFolder("repo.git").toPath();
        assertTrue(git.run(bare, "init", "-q", "--bare", "-b", "main").ok());
        Path seed = tmp.newFolder("seed").toPath();
        assertTrue(git.run(seed, "init", "-q", "-b", "main").ok());
        Files.writeString(seed.resolve("policy.xml"), "<policy>\n  <a>one</a>\n  <b>two</b>\n</policy>\n", StandardCharsets.UTF_8);
        git.commit(seed, "seed", "s", "s@localhost", false);
        assertTrue(git.run(seed, "remote", "add", "origin", bare.toString()).ok());
        assertTrue(git.run(seed, "push", "-q", "origin", "main").ok());

        Path mine = tmp.getRoot().toPath().resolve("mine");
        git.checkout(bare.toString(), "feature/x", "main", mine);
        Files.writeString(mine.resolve("policy.xml"), "<policy>\n  <a>mine</a>\n  <b>two</b>\n</policy>\n", StandardCharsets.UTF_8);
        git.commit(mine, "mine", "Alice", "alice@example.com", true);

        Path other = tmp.getRoot().toPath().resolve("other");
        git.checkout(bare.toString(), "main", "main", other);
        Files.writeString(other.resolve("policy.xml"), "<policy>\n  <a>theirs</a>\n  <b>two, changed</b>\n</policy>\n", StandardCharsets.UTF_8);
        git.commit(other, "theirs", "Bob", "bob@example.com", true);

        assertEquals(Boolean.FALSE, git.update(mine, "main", "Alice", null).get("merged"));
        Map<String, Object> c = git.conflicts(mine, "origin/main", "Alice", null);
        List<Map<String, Object>> files = (List<Map<String, Object>>) c.get("files");
        assertEquals(1, files.size());
        Map<String, Object> f = files.get(0);
        assertEquals("policy.xml", f.get("file"));
        assertTrue(String.valueOf(f.get("merged")), String.valueOf(f.get("merged")).contains("<<<<<<<"));
        assertTrue(String.valueOf(f.get("ours")).contains("mine"));
        assertTrue(String.valueOf(f.get("theirs")).contains("theirs"));
        assertFalse("nothing left half-merged", Files.exists(mine.resolve(".git/MERGE_HEAD")));

        String head = (String) c.get("head");
        String theirs = (String) c.get("theirs");
        try {
            git.resolve(mine, null, "origin/main", head, theirs, Map.of("policy.xml", (String) f.get("merged")), null, "Alice", null);
            throw new AssertionError("a text with conflict marks was committed");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("conflict marks"));
        }
        try {
            git.resolve(mine, null, "origin/main", "0".repeat(40), theirs, Map.of("policy.xml", "x"), null, "Alice", null);
            throw new AssertionError("a moved branch was accepted");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("moved"));
        }

        String settled = "<policy>\n  <a>mine</a>\n  <b>two, changed</b>\n</policy>\n";
        Map<String, Object> r = git.resolve(mine, null, "origin/main", head, theirs, Map.of("policy.xml", settled), "Merge main, keeping my <a>", "Alice", null);
        assertEquals(Boolean.TRUE, r.get("merged"));
        assertEquals(settled, Files.readString(mine.resolve("policy.xml")));
        assertEquals("a merge commit", 2, git.run(mine, "log", "-1", "--format=%P").out.trim().split(" ").length);
        assertEquals("Merge main, keeping my <a>", git.run(mine, "log", "-1", "--format=%s").out.trim());
        assertTrue(git.run(mine, "status", "--porcelain").out.isBlank());
    }
}
