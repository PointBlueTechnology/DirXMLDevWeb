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
import static org.junit.Assert.assertTrue;

/** A commit of everything, or of the deploy record alone (#128). */
public class GitCommitTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void theDeployRecordAloneLeavesTheRestOfTheWorkUncommitted() throws Exception {
        Git git = new Git(tmp.newFolder("data").toPath(), null);
        Path repo = tmp.newFolder("repo").toPath();
        Path tree = repo.resolve("tree");
        Files.createDirectories(tree);
        Files.writeString(tree.resolve("driverset.xml"), "<driverset/>", StandardCharsets.UTF_8);
        assertTrue(git.run(repo, "init", "-q", "-b", "main").ok());
        assertTrue(git.commit(repo, "seed", "me", "me@localhost", false).get("committed") == Boolean.TRUE);

        List<String> record = List.of("tree/" + Watcher.DEPLOY_LOG);
        assertEquals("no record yet: nothing to commit", Boolean.FALSE, git.commit(repo, "Deployed to lab", "me", null, false, record).get("committed"));

        Files.writeString(tree.resolve("driverset.xml"), "<driverset name=\"edited\"/>", StandardCharsets.UTF_8);
        Files.createDirectories(tree.resolve("deploy-log"));
        Files.writeString(tree.resolve("deploy-log/lab.jsonl"), "{\"env\":\"lab\"}\n", StandardCharsets.UTF_8);
        Map<String, Object> r = git.commit(repo, "Deployed to lab", "me", null, false, record);
        assertEquals(Boolean.TRUE, r.get("committed"));

        String inCommit = git.run(repo, "show", "--name-only", "--format=", "HEAD").out.trim();
        assertEquals("tree/deploy-log/lab.jsonl", inCommit);
        String left = git.run(repo, "status", "--porcelain").out.trim();
        assertTrue(left, left.endsWith("tree/driverset.xml") && !left.contains("deploy-log"));

        assertEquals("the record again, unchanged: nothing to commit", Boolean.FALSE, git.commit(repo, "again", "me", null, false, record).get("committed"));
        assertFalse(git.run(repo, "status", "--porcelain").out.isBlank());
    }

    @Test
    public void aMergeWorksWhereGitHasNoIdentityAsInTheImage() throws Exception {
        Git git = new Git(tmp.newFolder("data2").toPath(), null);
        Path home = tmp.newFolder("home").toPath();
        git.extraEnv.put("HOME", home.toString());
        git.extraEnv.put("GIT_CONFIG_GLOBAL", home.resolve("none").toString());
        git.extraEnv.put("GIT_CONFIG_NOSYSTEM", "1");
        git.extraEnv.put("EMAIL", "");
        Path repo = tmp.newFolder("repo2").toPath();
        Files.writeString(repo.resolve("a.txt"), "a", StandardCharsets.UTF_8);
        assertTrue(git.run(repo, "init", "-q", "-b", "main").ok());
        assertTrue("never guess an identity (macOS would, from the host name): as the image's git, which can't", git.run(repo, "config", "user.useConfigOnly", "true").ok());
        assertEquals(Boolean.TRUE, git.commit(repo, "seed", "me", "me@localhost", false).get("committed"));
        // the captured state on its own branch, and the person's change on main: a real merge commit is needed
        assertTrue(git.run(repo, "-c", "user.name=x", "-c", "user.email=x@x", "checkout", "-q", "-b", "as-found/lab/t1").ok());
        Files.writeString(repo.resolve("b.txt"), "vault", StandardCharsets.UTF_8);
        assertTrue(git.run(repo, "add", "-A").ok());
        assertTrue(git.run(repo, "-c", "user.name=x", "-c", "user.email=x@x", "commit", "-qm", "as found").ok());
        assertTrue(git.run(repo, "checkout", "-q", "main").ok());
        Files.writeString(repo.resolve("a.txt"), "mine", StandardCharsets.UTF_8);
        assertEquals(Boolean.TRUE, git.commit(repo, "my change", "me", "me@localhost", false).get("committed"));
        assertFalse("this git has no identity of its own", git.run(repo, "commit", "--allow-empty", "-qm", "x").ok());

        Map<String, Object> r = git.mergeLocal(repo, "as-found/lab/t1", "Jerry", "jerry@example.com");
        assertEquals(r.toString(), Boolean.TRUE, r.get("merged"));
        assertEquals("Jerry", git.run(repo, "log", "-1", "--format=%an").out.trim());
        assertTrue(Files.exists(repo.resolve("b.txt")));
    }
}
