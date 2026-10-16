package com.pointblue.dirxml.web;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * Merge into the base branch on the page (docs/git-workflow.md), against a bare repository standing in for a
 * server-made one: the branch's commits reach the remote's main, deploy logs from both sides merge line by line, a
 * conflict merges nothing, and production deploys only from main as the repository has it.
 */
public class GitMergeIntoBaseTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private Git git;
    private String url;

    private Path seed() throws Exception {
        git = new Git(tmp.newFolder("data").toPath(), null);
        Path bare = tmp.newFolder("repo.git").toPath();
        assertTrue(git.run(bare, "init", "-q", "--bare", "-b", "main").ok());
        url = bare.toString();
        Path first = tmp.newFolder("first").toPath();
        assertTrue(git.run(first, "init", "-q", "-b", "main").ok());
        Files.writeString(first.resolve("driverset.xml"), "<driverset/>\n", StandardCharsets.UTF_8);
        Files.writeString(first.resolve("policy.xml"), "<policy>one</policy>\n", StandardCharsets.UTF_8);
        Files.createDirectories(first.resolve("deploy-log"));
        Files.writeString(first.resolve("deploy-log/dev.jsonl"), "{\"env\":\"dev\",\"n\":0}\n", StandardCharsets.UTF_8);
        assertEquals(Boolean.TRUE, git.commit(first, "import", "seed", "seed@localhost", false).get("committed"));
        assertTrue(git.run(first, "remote", "add", "origin", url).ok());
        assertTrue(git.run(first, "push", "-q", "origin", "main").ok());
        return first;
    }

    private Path open(String name, String branch) throws Exception {
        Path dir = tmp.getRoot().toPath().resolve("ws-" + name + "-" + branch.replace('/', '_'));
        git.checkout(url, branch, "main", dir);
        return dir;
    }

    private String remoteFile(String file) throws Exception {
        return git.run(Path.of(url), "show", "main:" + file).out;
    }

    @Test
    public void aBranchIsMergedIntoMainAndBothSidesDeployLogsAreKept() throws Exception {
        seed();
        Path feature = open("alice", "feature/x");
        assertTrue(Files.readString(feature.resolve(".git/info/attributes")).contains(Git.UNION));
        Files.writeString(feature.resolve("policy.xml"), "<policy>two</policy>\n", StandardCharsets.UTF_8);
        Files.writeString(feature.resolve("deploy-log/dev.jsonl"), "{\"env\":\"dev\",\"n\":0}\n{\"env\":\"dev\",\"n\":1}\n", StandardCharsets.UTF_8);
        assertEquals(Boolean.TRUE, git.commit(feature, "the change, deployed to dev", "Alice", "alice@example.com", false).get("committed"));

        // meanwhile someone deployed from main and committed the record
        Path main = open("bob", "main");
        Files.writeString(main.resolve("deploy-log/dev.jsonl"), "{\"env\":\"dev\",\"n\":0}\n{\"env\":\"dev\",\"n\":2}\n", StandardCharsets.UTF_8);
        assertEquals(Boolean.TRUE, git.commit(main, "Deployed to dev", "Bob", "bob@example.com", true).get("committed"));

        Map<String, Object> preview = git.mergePreview(feature, "main");
        assertEquals(1, ((List<?>) preview.get("commits")).size());
        assertEquals(1, preview.get("behind"));
        assertEquals(0, preview.get("uncommitted"));

        Map<String, Object> r = git.mergeInto(feature, "main", "Alice", "alice@example.com");
        assertEquals(r.toString(), Boolean.TRUE, r.get("merged"));
        assertEquals("<policy>two</policy>\n", remoteFile("policy.xml"));
        String log = remoteFile("deploy-log/dev.jsonl");
        assertTrue(log, log.contains("\"n\":1") && log.contains("\"n\":2") && !log.contains("<<<<"));
        assertEquals("Merge branch 'feature/x' into main", git.run(Path.of(url), "log", "-1", "--format=%s", "main").out.trim());
        assertEquals("Alice", git.run(Path.of(url), "log", "-1", "--format=%an", "main").out.trim());
        assertEquals("the checkout stays on its branch", "feature/x", git.run(feature, "rev-parse", "--abbrev-ref", "HEAD").out.trim());
        assertTrue("the branch was pushed too", git.run(Path.of(url), "rev-parse", "--verify", "--quiet", "refs/heads/feature/x").ok());
        assertTrue(git.run(feature, "worktree", "list").out.trim().split("\n").length == 1);

        assertEquals(Boolean.FALSE, git.mergeInto(feature, "main", "Alice", null).get("merged"));   // nothing left to merge
    }

    @Test
    public void aConflictMergesNothingAndUncommittedWorkIsRefused() throws Exception {
        seed();
        Path feature = open("alice", "feature/y");
        Files.writeString(feature.resolve("policy.xml"), "<policy>alice</policy>\n", StandardCharsets.UTF_8);
        try {
            git.mergeInto(feature, "main", "Alice", null);
            throw new AssertionError("uncommitted work was merged");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage(), expected.getMessage().startsWith("commit first"));
        }
        git.commit(feature, "alice's", "Alice", null, false);
        Path main = open("bob", "main");
        Files.writeString(main.resolve("policy.xml"), "<policy>bob</policy>\n", StandardCharsets.UTF_8);
        git.commit(main, "bob's", "Bob", null, true);

        Map<String, Object> r = git.mergeInto(feature, "main", "Alice", null);
        assertEquals(Boolean.FALSE, r.get("merged"));
        assertEquals(List.of("policy.xml"), r.get("conflicts"));
        assertEquals("<policy>bob</policy>\n", remoteFile("policy.xml"));
        assertTrue(git.run(feature, "worktree", "list").out.trim().split("\n").length == 1);
    }

    @Test
    public void productionComesFromMainAsTheRepositoryHasIt() throws Exception {
        seed();
        Path feature = open("alice", "feature/z");
        assertTrue(git.productionSource(feature, "main").startsWith("a production deploy comes from main; this is feature/z"));

        Path main = open("alice", "main");
        assertNull(git.productionSource(main, "main"));

        Files.writeString(main.resolve("deploy-log/dev.jsonl"), "{\"env\":\"dev\",\"n\":0}\n{\"env\":\"stg\"}\n", StandardCharsets.UTF_8);
        git.commit(main, "Deployed to stg", "Alice", null, false);
        assertTrue(git.productionSource(main, "main").startsWith("push first: 1 commit(s)"));
        git.commit(main, null, "Alice", null, true);   // the bar's Push
        assertNull(git.productionSource(main, "main"));

        Path other = open("bob", "main");
        Files.writeString(other.resolve("policy.xml"), "<policy>newer</policy>\n", StandardCharsets.UTF_8);
        git.commit(other, "newer", "Bob", null, true);
        assertTrue(git.productionSource(main, "main").startsWith("main has 1 commit(s) this copy lacks"));
        assertEquals(Boolean.TRUE, git.update(main, "main", "Alice", null).get("merged"));   // Get latest main
        assertNull(git.productionSource(main, "main"));
        assertFalse(Files.readString(main.resolve("policy.xml")).contains("one"));
    }
}
