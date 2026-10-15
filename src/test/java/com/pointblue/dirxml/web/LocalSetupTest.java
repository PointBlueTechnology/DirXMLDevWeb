package com.pointblue.dirxml.web;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/** {@code idmweb setup}, the local install written from inside the image (docs/simple-install.md). */
public class LocalSetupTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private String run(Path dir, String... args) throws Exception {
        String[] all = new String[args.length + 2];
        all[0] = "--dir";
        all[1] = dir.toString();
        System.arraycopy(args, 0, all, 2, args.length);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();
        int rc = LocalSetup.main(all, new PrintStream(out, true, StandardCharsets.UTF_8), new PrintStream(err, true, StandardCharsets.UTF_8));
        String o = out.toString(StandardCharsets.UTF_8);
        assertEquals(err.toString(StandardCharsets.UTF_8), 0, rc);
        return o;
    }

    private static String read(Path p) throws Exception {
        return Files.readString(p, StandardCharsets.UTF_8);
    }

    private static String token(Path dir, String key) throws Exception {
        for (String l : Files.readAllLines(dir.resolve("idmweb.env"))) {
            if (l.startsWith(key + "=")) {
                return l.substring(key.length() + 1);
            }
        }
        return null;
    }

    @Test
    public void aFreshFolderWithoutATree() throws Exception {
        Path dir = tmp.newFolder("idmweb").toPath();
        String out = run(dir, "--user", "jerry");
        String compose = read(dir.resolve("compose.yml"));
        assertTrue(compose, compose.contains("container_name: idmweb") && compose.contains("./repo.git:/srv/repo.git"));
        String dotEnv = read(dir.resolve(".env"));
        assertTrue(dotEnv, dotEnv.contains("IDMWEB_IMAGE=ghcr.io/pointbluetechnology/dirxml-dev-web:" + Serve.VERSION + "\n"));
        assertTrue(dotEnv, dotEnv.contains("IDMWEB_PORT=8080\n") && dotEnv.matches("(?s).*IDMWEB_UID=\\d+\n.*"));
        String hosted = read(dir.resolve("config/hosted.properties"));
        assertTrue(hosted, hosted.contains("token.user=jerry\n") && hosted.contains("public.url=http://localhost:8080\n"));
        assertFalse("no tree, no project lines", hosted.contains("PROJECT") || hosted.contains("projects="));
        String mine = token(dir, "IDMWEB_TOKEN");
        assertTrue(mine != null && mine.length() >= 30 && token(dir, "IDMWEB_AGENT_TOKEN") != null && !mine.equals(token(dir, "IDMWEB_AGENT_TOKEN")));
        assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(dir.resolve("idmweb.env"))));
        assertEquals("", read(dir.resolve("config/environments.properties")));
        for (String d : List.of("data", "lib", "repo.git")) {
            assertTrue(d, Files.isDirectory(dir.resolve(d)));
        }
        assertTrue(out, out.contains("http://localhost:8080/auth/login#signin=" + mine));
        assertTrue(out, out.contains("docker compose -f") && out.contains("docker exec idmweb idm validate tree") && out.contains("No tree yet"));
    }

    @Test
    public void aReRunKeepsTokensAndConfigurationAndTakesANewPortAndImage() throws Exception {
        Path dir = tmp.newFolder("idmweb").toPath();
        run(dir);
        String t1 = token(dir, "IDMWEB_TOKEN");
        Files.writeString(dir.resolve("config/hosted.properties"), read(dir.resolve("config/hosted.properties")) + "# mine\n");
        String out = run(dir, "--port", "8090", "--image", "dirxml-dev-web:dev");
        assertEquals(t1, token(dir, "IDMWEB_TOKEN"));
        String hosted = read(dir.resolve("config/hosted.properties"));
        assertTrue("an edit is kept", hosted.contains("# mine"));
        assertTrue("public.url follows the port", hosted.contains("public.url=http://localhost:8090\n"));
        String dotEnv = read(dir.resolve(".env"));
        assertTrue(dotEnv, dotEnv.contains("IDMWEB_IMAGE=dirxml-dev-web:dev\n") && dotEnv.contains("IDMWEB_PORT=8090\n"));
        assertTrue(out, out.contains("http://localhost:8090/auth/login#signin=" + t1));
    }

    @Test
    public void aTreeSeedsTheRepository() throws Exception {
        Path dir = tmp.newFolder("idmweb").toPath();
        Path tree = tmp.newFolder("tree").toPath();
        Files.writeString(tree.resolve("driverset.xml"), "<driverset/>");
        Files.createDirectories(tree.resolve("drivers/AD"));
        Files.writeString(tree.resolve("drivers/AD/driver.xml"), "<driver/>");
        Path cases = tmp.newFolder("cases").toPath();
        Files.writeString(cases.resolve("c1.xml"), "<case/>");
        String out = run(dir, "--tree", tree.toString(), "--cases", cases.toString(), "--project", "lab");
        assertTrue(out, out.contains("repository: repo.git") && out.contains("Project 'lab' from your tree"));
        Process p = new ProcessBuilder("git", "--git-dir", dir.resolve("repo.git").toString(), "ls-tree", "-r", "--name-only", "main")
            .redirectErrorStream(true).start();
        String files = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertEquals(0, p.waitFor());
        assertTrue(files, files.contains("tree/driverset.xml") && files.contains("tree/drivers/AD/driver.xml")
            && files.contains("cases/c1.xml") && files.contains(".gitignore"));
        String hosted = read(dir.resolve("config/hosted.properties"));
        assertTrue(hosted, hosted.contains("projects=lab\n") && hosted.contains("project.lab.repo.url=/srv/repo.git"));
        // a second run does not seed again
        assertFalse(run(dir, "--tree", tree.toString()).contains("repository: repo.git"));
    }

    @Test
    public void environmentsAreSplitIntoDefinitionsAndYourCredentials() throws Exception {
        Path dir = tmp.newFolder("idmweb").toPath();
        Path src = tmp.newFolder("cli").toPath();
        Files.writeString(src.resolve("environments.properties"), String.join("\n",
            "lab.url=ldaps://lab:636", "lab.driverSet=cn=ds,o=system", "lab.bindDn=cn=admin,o=system",
            "lab.password=s3cret", "lab.trustAll=true", "lab.secrets=lab.secrets", "lab.tier=dev", ""));
        Files.writeString(src.resolve("lab.secrets"), "AD.named.x=y\n");
        String out = run(dir, "--user", "jerry", "--environments", src.resolve("environments.properties").toString());
        String defs = read(dir.resolve("config/environments.properties"));
        assertTrue(defs, defs.contains("lab.url=") && defs.contains("lab.secrets=lab.secrets") && defs.contains("lab.tier=dev"));
        assertFalse(defs, defs.contains("password") || defs.contains("bindDn") || defs.contains("trustAll"));
        Path mine = dir.resolve("data/users/jerry/environments.properties");
        String creds = read(mine);
        assertTrue(creds, creds.contains("lab.bindDn=") && creds.contains("lab.password=s3cret") && creds.contains("lab.trustAll=true"));
        assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(mine)));
        assertTrue("driver secrets come along", Files.exists(dir.resolve("config/lab.secrets")));
        assertTrue(out, out.contains("3 credential line(s)") && out.contains("driver secrets: copied lab.secrets"));

        // an older install whose config/ file holds a password is split on the next run
        Files.writeString(dir.resolve("config/environments.properties"), defs + "lab.password=newer\nqa.url=ldaps://qa:636\nqa.password=qa1\n");
        String again = run(dir, "--user", "jerry");
        assertTrue(again, again.contains("before-split"));
        assertFalse(read(dir.resolve("config/environments.properties")).contains("password"));
        String merged = read(mine);
        assertTrue("your existing value stays", merged.contains("lab.password=s3cret") && !merged.contains("lab.password=newer"));
        assertTrue(merged, merged.contains("qa.password=qa1"));
    }

    @Test
    public void refusalsSayWhatToDo() throws Exception {
        ByteArrayOutputStream err = new ByteArrayOutputStream();
        PrintStream e = new PrintStream(err, true, StandardCharsets.UTF_8);
        PrintStream o = new PrintStream(new ByteArrayOutputStream(), true, StandardCharsets.UTF_8);
        assertEquals(1, LocalSetup.main(new String[] {"--dir", tmp.getRoot().toPath().resolve("nope").toString()}, o, e));
        assertTrue(err.toString(), err.toString().contains("is not mounted"));
        Path notATree = tmp.newFolder("empty").toPath();
        assertEquals(1, LocalSetup.main(new String[] {"--dir", tmp.newFolder("d").toString(), "--tree", notATree.toString()}, o, e));
        assertTrue(err.toString(), err.toString().contains("no driverset.xml"));
        assertEquals(2, LocalSetup.main(new String[] {"--port", "x"}, o, e));
        assertEquals(2, LocalSetup.main(new String[] {"--user", "a b"}, o, e));
        assertEquals(2, LocalSetup.main(new String[] {"--bogus", "1"}, o, e));
        Path ro = tmp.newFolder("ro").toPath();
        Files.setPosixFilePermissions(ro, PosixFilePermissions.fromString("r-xr-xr-x"));
        try {
            assertEquals(1, LocalSetup.main(new String[] {"--dir", ro.toString()}, o, e));
            assertTrue(err.toString(), err.toString().contains("-u \"$(id -u):$(id -g)\""));
        } finally {
            Files.setPosixFilePermissions(ro, PosixFilePermissions.fromString("rwxr-xr-x"));
        }
    }

    @Test
    public void theTemplatesAreInTheJar() throws Exception {
        assertTrue(LocalSetup.template("compose.yml").contains("container_name: idmweb"));
        assertTrue(LocalSetup.template("compose.podman.yml").contains("keep-id"));
        assertTrue(LocalSetup.template("config/hosted.properties").contains("identity=token"));
    }
}
