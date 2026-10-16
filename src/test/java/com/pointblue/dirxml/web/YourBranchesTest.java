package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The branch switcher lists the person's own branches, pushed or not, with what is not pushed. */
public class YourBranchesTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static void git(Path dir, String... args) throws Exception {
        String[] cmd = new String[args.length + 5];
        cmd[0] = "git";
        cmd[1] = "-c";
        cmd[2] = "user.email=t@x";
        cmd[3] = "-c";
        cmd[4] = "user.name=t";
        System.arraycopy(args, 0, cmd, 5, args.length);
        Process p = new ProcessBuilder(cmd).directory(dir.toFile()).redirectErrorStream(true).start();
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (p.waitFor() != 0) {
            throw new AssertionError("git " + String.join(" ", args) + ": " + out);
        }
    }

    private static void commit(Path dir, String file) throws Exception {
        Files.writeString(dir.resolve(file), file);
        git(dir, "add", "-A");
        git(dir, "commit", "-q", "-m", file);
    }

    @Test
    public void yourBranchesIncludeTheOnesNeverPushed() throws Exception {
        Path data = tmp.newFolder("data").toPath();
        Path bare = data.resolve("projects").resolve("p1.git");
        Files.createDirectories(bare);
        git(bare, "init", "--bare", "-q", "-b", "main");
        Path seed = tmp.newFolder("seed").toPath();
        git(seed, "clone", "-q", bare.toString(), ".");
        commit(seed, "driverset.xml");
        git(seed, "push", "-q", "origin", "HEAD:main");
        Files.writeString(data.resolve("hosted.properties"), "public.url=https://idm.example.com/\ndata.dir=" + data
            + "\nprojects=p1\nproject.p1.repo.url=" + bare + "\nroles.editor=*\nroles.deployer=*\n");
        Hosted h = Hosted.load(data.resolve("hosted.properties"));
        Workspaces ws = new Workspaces(h, new Git(data, null));

        // alice's workspaces, as the server keeps them: one folder per branch under workspaces/<project>/<subject>/
        Path mine = data.resolve("workspaces/p1/alice");
        Path main = mine.resolve("main");
        Files.createDirectories(main);
        git(main, "clone", "-q", bare.toString(), ".");
        Path runbook = mine.resolve("ad-runbook");                 // started on the page, committed, never pushed
        Files.createDirectories(runbook);
        git(runbook, "clone", "-q", bare.toString(), ".");
        git(runbook, "checkout", "-q", "-b", "ad-runbook");
        commit(runbook, "ad.xml");
        Path shared = mine.resolve("feature_x");                   // pushed, then two more commits
        Files.createDirectories(shared);
        git(shared, "clone", "-q", bare.toString(), ".");
        git(shared, "checkout", "-q", "-b", "feature/x");
        commit(shared, "a.xml");
        git(shared, "push", "-q", "-u", "origin", "feature/x");
        commit(shared, "b.xml");
        commit(shared, "c.xml");
        Files.createDirectories(data.resolve("workspaces/p1/bob/other"));   // someone else's: not listed

        Session.Principal alice = new Session.Principal("alice", "Alice", null, List.of(), true, true);
        List<Map<String, Object>> yours = ws.yourBranches("p1", alice);
        assertEquals(List.of(
            Map.of("branch", "ad-runbook", "pushed", false, "ahead", 1),
            Map.of("branch", "feature/x", "pushed", true, "ahead", 2),
            Map.of("branch", "main", "pushed", true, "ahead", 0)), yours);
        assertEquals("the repository's list misses the unpushed one", List.of("feature/x", "main"), ws.branches("p1"));
        assertEquals(List.of(), ws.yourBranches("p1", new Session.Principal("carol", "Carol", null, List.of(), true, true)));
    }
}
