package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Moving a project from the repository the server made to a remote of its own (docs/connections-ui.md). */
public class RepositoryServiceTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static String git(Path dir, String... args) throws Exception {
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
        return out.trim();
    }

    private static void commit(Path dir, String file) throws Exception {
        Files.writeString(dir.resolve(file), file);
        git(dir, "add", "-A");
        git(dir, "commit", "-q", "-m", file);
    }

    @Test
    @SuppressWarnings("unchecked")
    public void aServerMadeRepositoryMovesToAnEmptyRemoteAndTakesEveryWorkspaceAlong() throws Exception {
        Path data = tmp.newFolder("data").toPath();
        Path bare = data.resolve("projects/PROD.git");
        Files.createDirectories(bare);
        git(bare, "init", "--bare", "-q", "-b", "main");
        Path seed = tmp.newFolder("seed").toPath();
        git(seed, "clone", "-q", bare.toString(), ".");
        commit(seed, "driverset.xml");
        git(seed, "push", "-q", "origin", "HEAD:main");
        git(seed, "tag", "v1");
        git(seed, "push", "-q", "origin", "v1");
        Files.writeString(data.resolve("hosted.properties"), "public.url=https://idm.example.com/\ndata.dir=" + data
            + "\nprojects=PROD\nproject.PROD.repo.url=" + bare + "\nroles.editor=*\nroles.deployer=*\n");
        Hosted h = Hosted.load(data.resolve("hosted.properties"));
        Workspaces ws = new Workspaces(h, new Git(data, null));
        RepositoryService svc = new RepositoryService(h, ws, Audit.none());

        // jerry's workspace: a branch with a commit he never pushed, and a file he never committed
        Path jerry = data.resolve("workspaces/PROD/jerry/ad-runbook");
        Files.createDirectories(jerry);
        git(jerry, "clone", "-q", bare.toString(), ".");
        git(jerry, "checkout", "-q", "-b", "ad-runbook");
        commit(jerry, "ad.xml");
        Files.writeString(jerry.resolve("draft.xml"), "x");

        Map<String, Object> d = svc.describe("PROD");
        assertEquals(true, d.get("serverMade"));
        assertEquals(null, d.get("pushesTo"));

        Path remote = tmp.newFolder("github", "prod-idm.git").toPath();
        git(remote, "init", "--bare", "-q", "-b", "main");
        Map<String, Object> check = svc.check("PROD", remote.toString(), null);
        assertEquals(true, check.get("ok"));
        assertEquals(true, check.get("empty"));
        assertEquals(1L, check.get("branches"));
        assertEquals(1L, check.get("tags"));
        List<Map<String, Object>> unpushed = (List<Map<String, Object>>) check.get("unpushed");
        assertEquals(1, unpushed.size());
        assertEquals("jerry", unpushed.get(0).get("person"));
        assertEquals("ad-runbook", unpushed.get(0).get("branch"));
        assertEquals(1, unpushed.get(0).get("ahead"));
        assertEquals(1, unpushed.get(0).get("uncommitted"));

        // a remote with history of its own is refused
        Path other = tmp.newFolder("other.git").toPath();
        git(other, "init", "--bare", "-q", "-b", "main");
        Path o = tmp.newFolder("o").toPath();
        git(o, "clone", "-q", other.toString(), ".");
        commit(o, "someone-else.txt");
        git(o, "push", "-q", "origin", "HEAD:main");
        assertEquals(false, svc.check("PROD", other.toString(), null).get("ok"));

        try {
            svc.move(null, "PROD", remote.toString(), null, "prod");
            fail("moved without the name typed");
        } catch (TreeService.BadRequest expected) {
            // the name must be typed exactly
        }

        Map<String, Object> moved = svc.move(null, "PROD", remote.toString(), null, "PROD");
        assertEquals(true, moved.get("ok"));
        assertEquals(1, moved.get("workspaces"));
        assertEquals(git(seed, "rev-parse", "HEAD"), git(remote, "rev-parse", "refs/heads/main"));
        assertEquals("the tag came too", git(seed, "rev-parse", "v1"), git(remote, "rev-parse", "refs/tags/v1"));
        assertFalse("the old repository was renamed, not deleted", Files.exists(bare));
        assertTrue(Files.isDirectory(Path.of((String) moved.get("kept"))));
        assertTrue(Files.readString(data.resolve("hosted.properties")).contains("project.PROD.repo.url=" + remote));
        assertEquals(remote.toString(), ws.project("PROD").url);

        // nothing in jerry's workspace was lost: his origin is the new remote, his commit pushes there
        assertEquals(remote.toString(), git(jerry, "remote", "get-url", "origin"));
        assertTrue(Files.exists(jerry.resolve("draft.xml")));
        git(jerry, "push", "-q", "origin", "ad-runbook");
        assertEquals(git(jerry, "rev-parse", "HEAD"), git(remote, "rev-parse", "refs/heads/ad-runbook"));

        // later the remote moves (a renamed organization): Change remote checks it is the same repository
        Path renamed = tmp.newFolder("github2").toPath().resolve("prod-idm.git");
        git(tmp.getRoot().toPath(), "clone", "-q", "--bare", remote.toString(), renamed.toString());
        try {
            svc.change(null, "PROD", other.toString() + "-missing", null, "PROD");
            fail("changed to a remote that can't be reached");
        } catch (TreeService.BadRequest expected) {
            // refused
        }
        Map<String, Object> changed = svc.change(null, "PROD", renamed.toString(), null, "PROD");
        assertEquals(true, changed.get("ok"));
        assertEquals(renamed.toString(), git(jerry, "remote", "get-url", "origin"));
    }
}
