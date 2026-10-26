package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.pointblue.dirxml.dev.ascode.AsCodeWriter;
import com.pointblue.dirxml.dev.deploy.Overrides;
import com.pointblue.dirxml.dev.model.Driver;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.model.Policy;
import com.pointblue.dirxml.dev.model.PolicyLink;
import com.pointblue.dirxml.dev.model.PolicySet;
import com.pointblue.dirxml.dev.model.Scope;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.w3c.dom.Element;

/**
 * Two projects on one server, QA and production, each its own repository: production compared with QA from both
 * base branches as pushed, and a policy promoted into a new branch of production, committed with the trailer and
 * pushed, while production's main and its values stay as they were.
 */
public class PromotionServiceTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static final String POLICY = "drivers/AD/subscriber/sub-ctp.policy.xml";

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
        return out;
    }

    private static Element xml(String s) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        return f.newDocumentBuilder().parse(new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8))).getDocumentElement();
    }

    private static String rule(String description) {
        return "<policy><rule><description>" + description + "</description><conditions/><actions/></rule></policy>";
    }

    private static DriverSet tree(String description, String users) throws Exception {
        DriverSet ds = new DriverSet("dvs");
        ds.dn = "cn=dvs,o=system";
        Driver d = new Driver("AD");
        d.dn = "cn=AD,cn=dvs,o=system";
        d.shimClass = "com.example.Shim";
        d.config.put(Driver.CONFIG_VALUES, xml("<configuration-values><definitions><definition display-name=\"Users\" name=\"drv.users\" type=\"string\"><value>"
            + users + "</value></definition></definitions></configuration-values>"));
        d.subscriber.policies.add(new Policy("sub-ctp", Scope.SUBSCRIBER, "AD", xml(rule(description))));
        d.links.add(new PolicyLink(PolicySet.SUB_COMMAND, "drivers/AD/subscriber/sub-ctp", 0));
        ds.drivers.add(d);
        return ds;
    }

    /** A bare repository whose main holds {@code ds} as a tree. */
    private Path repo(Path data, String name, DriverSet ds) throws Exception {
        Path bare = data.resolve("projects").resolve(name + ".git");
        Files.createDirectories(bare);
        git(bare, "init", "--bare", "-q", "-b", "main");
        Path seed = tmp.newFolder("seed-" + name).toPath();
        git(seed, "clone", "-q", bare.toString(), ".");
        AsCodeWriter.write(ds, seed);
        git(seed, "add", "-A");
        git(seed, "commit", "-q", "-m", "first");
        git(seed, "push", "-q", "origin", "HEAD:main");
        return seed;
    }

    private static void push(Path seed, DriverSet ds, String message) throws Exception {
        AsCodeWriter.write(ds, seed);
        git(seed, "add", "-A");
        git(seed, "commit", "-q", "-m", message);
        git(seed, "push", "-q", "origin", "HEAD:main");
    }

    private static PromotionService.Choices files(String... paths) {
        PromotionService.Choices ch = new PromotionService.Choices();
        ch.objects.addAll(List.of(paths));
        return ch;
    }

    @Test
    public void pairingAndAKnownDifferenceLandOnBranchesOfTheirOwn() throws Exception {
        Path data = tmp.newFolder("data").toPath();
        Path qaSeed = repo(data, "acme-qa", tree("r1", "users"));
        repo(data, "acme-prod", tree("r1", "users"));
        push(qaSeed, tree("qa changed it", "qa-users"), "qa work");
        Files.writeString(data.resolve("hosted.properties"), "public.url=https://idm.example.com/\ndata.dir=" + data
            + "\nprojects=acme-qa,acme-prod\nproject.acme-qa.repo.url=" + data.resolve("projects/acme-qa.git")
            + "\nproject.acme-prod.repo.url=" + data.resolve("projects/acme-prod.git") + "\nroles.editor=*\nroles.deployer=*\n");
        Workspaces ws = new Workspaces(Hosted.load(data.resolve("hosted.properties")), new Git(data, null));
        PromotionService svc = new PromotionService(ws);
        Project prod = ws.project("acme-prod");
        Session.Store store = new Session.Store(3600);
        Session alice = store.create(new Session.Principal("alice", "Alice", "alice@example.com", List.of(), true, false));

        Map<String, Object> proposal = svc.proposedMap(prod, "acme-qa");
        assertEquals(null, proposal.get("current"));
        String map = "# the two name everything alike\n";
        Map<String, Object> c = svc.compare(prod, "acme-qa", map);
        Map<String, String[]> known = new java.util.LinkedHashMap<>();
        known.put("drivers/AD.gcv.drv.users", new String[] {"intended", "each project's own"});
        Map<String, Object> r = svc.pair(alice, store, prod, "acme-qa", (String) c.get("revision"), map, List.of(POLICY), known);
        assertEquals(r.toString(), true, r.get("ok"));
        String branch = (String) r.get("branch");
        assertTrue(branch, branch.startsWith("promote/acme-qa-pair-"));
        Path check = tmp.newFolder("pair").toPath();
        git(check, "clone", "-q", "--branch", branch, data.resolve("projects/acme-prod.git").toString(), ".");
        assertTrue(Files.isRegularFile(check.resolve("promotions/acme-qa.json")));
        assertTrue(Files.readString(check.resolve("promotions/acme-qa.known.json")).contains("each project's own"));
        assertEquals("the map as written, comment and all", map, Files.readString(check.resolve("promotions/acme-qa.properties")));
        assertTrue(git(check, "log", "-1", "--format=%B").startsWith("Pair with acme-qa"));

        // a refused pairing makes no branch: a pending path that doesn't differ
        Map<String, Object> bad = svc.pair(alice, store, prod, "acme-qa", (String) c.get("revision"), map, List.of("drivers/AD/nope.xml"), Map.of());
        assertFalse(Boolean.TRUE.equals(bad.get("ok")));

        // a known difference alone, without promoting anything
        Map<String, Object> plain = svc.compare(prod, "acme-qa", null);
        PromotionService.Choices decision = new PromotionService.Choices();
        decision.known.put(POLICY, new String[] {"later", null});
        Map<String, Object> k = svc.apply(alice, store, prod, "acme-qa", (String) plain.get("revision"), decision);
        assertEquals(k.toString(), true, k.get("ok"));
        assertEquals("Known differences with acme-qa", k.get("title"));
    }

    @Test
    public void aPolicyPromotedFromQaLandsOnANewBranchOfProduction() throws Exception {
        Path data = tmp.newFolder("data").toPath();
        Path qaSeed = repo(data, "acme-qa", tree("r1", "users"));
        repo(data, "acme-prod", tree("r1", "users"));
        Files.writeString(data.resolve("hosted.properties"), "public.url=https://idm.example.com/\ndata.dir=" + data
            + "\nprojects=acme-qa,acme-prod\nproject.acme-qa.repo.url=" + data.resolve("projects/acme-qa.git")
            + "\nproject.acme-prod.repo.url=" + data.resolve("projects/acme-prod.git") + "\nroles.editor=*\nroles.deployer=*\n");
        Hosted h = Hosted.load(data.resolve("hosted.properties"));
        Workspaces ws = new Workspaces(h, new Git(data, null));
        PromotionService svc = new PromotionService(ws);
        Project prod = ws.project("acme-prod");

        assertEquals(List.of(Map.of("name", "acme-qa", "base", "main")), svc.projects(prod).get("projects"));
        assertTrue("no differences yet", ((List<?>) svc.compare(prod, "acme-qa", null).get("items")).isEmpty());

        // QA changes the policy and its own value, and pushes
        push(qaSeed, tree("qa changed it", "qa-users"), "qa work");
        Map<String, Object> c = svc.compare(prod, "acme-qa", null);
        List<?> items = (List<?>) c.get("items");
        assertEquals(c.toString(), 2, items.size());
        Map<?, ?> file = (Map<?, ?>) items.stream().filter(i -> POLICY.equals(((Map<?, ?>) i).get("path"))).findFirst().orElseThrow();
        assertEquals("unpaired", file.get("bucket"));
        assertTrue(String.valueOf(file.get("after")).contains("qa changed it"));
        assertTrue(String.valueOf(file.get("before")).contains("r1"));
        Map<?, ?> value = (Map<?, ?>) items.stream().filter(i -> "value".equals(((Map<?, ?>) i).get("kind"))).findFirst().orElseThrow();
        assertEquals("drivers/AD.gcv.drv.users", value.get("path"));
        assertEquals("qa-users", value.get("source"));

        Session.Store store = new Session.Store(3600);
        Session alice = store.create(new Session.Principal("alice", "Alice", "alice@example.com", List.of(), true, false));
        try {
            svc.apply(alice, store, prod, "acme-qa", "not-the-revision", files(POLICY));
            fail("a stale review was applied");
        } catch (TreeService.Stale expected) {
            // compare again
        }
        Map<String, Object> refused = svc.apply(alice, store, prod, "acme-qa", (String) c.get("revision"), files("drivers/AD/nope.xml"));
        assertFalse(Boolean.TRUE.equals(refused.get("ok")));
        assertTrue(String.valueOf(refused.get("refusal")).contains("nothing differs"));

        Map<String, Object> r = svc.apply(alice, store, prod, "acme-qa", (String) c.get("revision"), files(POLICY));
        assertEquals(r.toString(), true, r.get("ok"));
        String branch = (String) r.get("branch");
        assertTrue(branch, branch.matches("promote/acme-qa-\\d{8}-\\d{6}"));
        assertEquals(true, r.get("pushed"));
        assertNotNull("the session is on the new branch", alice.workspace);

        // the branch, as the repository has it: the policy, production's value, the record, the trailer
        Path check = tmp.newFolder("check").toPath();
        git(check, "clone", "-q", "--branch", branch, data.resolve("projects/acme-prod.git").toString(), ".");
        assertTrue(Files.readString(check.resolve(POLICY)).contains("qa changed it"));
        assertTrue(Files.readString(check.resolve("drivers/AD/config-values.xml")).contains("<value>users</value>"));
        assertTrue(Files.isRegularFile(check.resolve("promotions/acme-qa.json")));
        String log = git(check, "log", "-1", "--format=%B");
        assertTrue(log, log.startsWith("Promote from acme-qa: 1 file(s)"));
        String qaHead = git(qaSeed, "rev-parse", "HEAD").trim();
        assertTrue(log, log.contains("Promoted-from: acme-qa@" + qaHead));
        String author = git(check, "log", "-1", "--format=%an <%ae>").trim();
        assertEquals("Alice <alice@example.com>", author);

        // production's main is untouched until the branch is merged
        Path mainCheck = tmp.newFolder("main").toPath();
        git(mainCheck, "clone", "-q", "--branch", "main", data.resolve("projects/acme-prod.git").toString(), ".");
        assertTrue(Files.readString(mainCheck.resolve(POLICY)).contains("r1"));
        assertFalse(Files.exists(mainCheck.resolve("promotions")));
        assertEquals("users", Overrides.resolve(com.pointblue.dirxml.dev.ascode.AsCodeReader.read(check), "drivers/AD.gcv.drv.users").value());
    }
}
