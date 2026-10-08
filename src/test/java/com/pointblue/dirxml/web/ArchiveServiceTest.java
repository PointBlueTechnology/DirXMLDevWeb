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

/** A project put away: its repository bundled, its data moved aside, the project forgotten (#76). */
public class ArchiveServiceTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static void git(Path dir, String... args) throws Exception {
        String[] cmd = new String[args.length + 1];
        cmd[0] = "git";
        System.arraycopy(args, 0, cmd, 1, args.length);
        Process p = new ProcessBuilder(cmd).directory(dir.toFile()).redirectErrorStream(true).start();
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (p.waitFor() != 0) {
            throw new AssertionError("git " + String.join(" ", args) + ": " + out);
        }
    }

    @Test
    public void archiveBundlesMovesAsideAndForgets() throws Exception {
        Path data = tmp.newFolder("data").toPath();
        // a server-held bare repository with one commit on main
        Path bare = data.resolve("projects").resolve("p1.git");
        Files.createDirectories(bare);
        git(bare, "init", "--bare", "-q", "-b", "main");
        Path work = tmp.newFolder("work").toPath();
        git(work, "clone", "-q", bare.toString(), ".");
        Files.createDirectories(work.resolve("tree"));
        Files.writeString(work.resolve("tree/driverset.xml"), "<driver-set/>");
        git(work, "add", "-A");
        git(work, "-c", "user.email=t@x", "-c", "user.name=t", "commit", "-q", "-m", "init");
        git(work, "push", "-q", "origin", "HEAD:main");
        // the hosted configuration naming it, and the things the server holds for it
        Path conf = data.resolve("hosted.properties");
        Files.writeString(conf, "public.url=https://idm.example.com/\ndata.dir=" + data + "\nprojects=p1,p2\nproject.p1.repo.url=" + bare + "\nproject.p1.repo.tree=tree\nproject.p2.repo.url=https://github.com/org/other.git\nroles.editor=*\nroles.deployer=*\n");
        Hosted h = Hosted.load(conf);
        Files.createDirectories(data.resolve("workspaces/p1/alice/main"));
        Files.writeString(data.resolve("workspaces/p1/alice/main/x"), "");
        Files.createDirectories(data.resolve("users/alice/traces/p1"));
        Files.writeString(data.resolve("users/alice/traces/p1/a.trace"), "");
        Files.createDirectories(data.resolve("users/alice/traces/p2"));
        Files.createDirectories(data.resolve("secrets"));
        Files.writeString(data.resolve("secrets/p1.repo.token"), "tok");
        Workspaces workspaces = new Workspaces(h, new Git(data, null));
        ArchiveService svc = new ArchiveService(h, workspaces, Audit.none());

        Map<String, Object> r = svc.archive(null, "p1");
        Path dir = Path.of((String) r.get("dir"));
        Path bundle = dir.resolve("p1.bundle");
        assertTrue(Files.isRegularFile(bundle));
        git(work, "bundle", "verify", bundle.toString());
        assertTrue("workspaces moved", Files.isRegularFile(dir.resolve("workspaces/alice/main/x")));
        assertFalse(Files.exists(data.resolve("workspaces/p1")));
        assertTrue("the person's recordings moved", Files.isRegularFile(dir.resolve("traces/alice/a.trace")));
        assertTrue("another project's recordings stay", Files.isDirectory(data.resolve("users/alice/traces/p2")));
        assertTrue("the server-made repository moved", Files.isDirectory(dir.resolve("p1.git")));
        assertFalse(Files.exists(bare));
        assertTrue("the token moved", Files.isRegularFile(dir.resolve("p1.repo.token")));
        assertFalse("the project is forgotten", h.projects.containsKey("p1"));
        assertTrue(h.projects.containsKey("p2"));
        assertFalse(Files.readString(conf).contains("project.p1."));
        assertTrue(Files.readString(conf).contains("projects=p2"));

        List<Map<String, Object>> list = svc.list();
        assertEquals(1, list.size());
        assertEquals("p1", list.get(0).get("project"));
        assertEquals("p1.bundle", list.get(0).get("bundle"));
        assertEquals(bundle, svc.bundle((String) list.get(0).get("name")));
        try {
            svc.bundle("../etc");
            throw new AssertionError("left the archive directory");
        } catch (TreeService.BadRequest expected) {
            // a name that could leave the directory is refused
        }
        // the bundle restores the repository anywhere
        Path restored = tmp.newFolder("restored").toPath();
        git(restored, "clone", "-q", bundle.toString(), ".");
        assertTrue(Files.isRegularFile(restored.resolve("tree/driverset.xml")));
    }
}
