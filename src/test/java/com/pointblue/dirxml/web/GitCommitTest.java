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
}
