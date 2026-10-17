package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.pointblue.dirxml.dev.ascode.AsCodeReader;
import com.pointblue.dirxml.dev.ascode.AsCodeWriter;
import com.pointblue.dirxml.dev.model.Driver;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.xml.CanonicalXml;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * A granular update from the vault (Update this branch from <env>…, the files ticked) and a discard of one
 * uncommitted file (the Changes view): the rest of the tree stays as the branch has it.
 */
public class GranularUpdateTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static DriverSet model(String a, String b) {
        DriverSet ds = new DriverSet("Set");
        ds.dn = "cn=Set,o=system";
        for (String[] d : new String[][] {{"A", a}, {"B", b}}) {
            Driver drv = new Driver(d[0]);
            drv.shimClass = "com.example.Shim";
            drv.config.put(Driver.CONFIG_VALUES, CanonicalXml.parse("<configuration-values><definitions><definition display-name=\"v\" name=\"v\" type=\"string\"><value>"
                + d[1] + "</value></definition></definitions></configuration-values>").getDocumentElement());
            ds.drivers.add(drv);
        }
        return ds;
    }

    @Test
    @SuppressWarnings("unchecked")
    public void onlyTheTickedFilesAreTaken() throws Exception {
        Path tree = tmp.newFolder("tree").toPath();
        AsCodeWriter.write(model("a1", "b1"), tree);
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);
            DriverSet live = model("a2", "b2");   // the vault changed both drivers
            Map<String, Object> plan = service.pull(live, "lab", List.of(), true, "", new ArrayList<>());
            List<String> changed = (List<String>) plan.get("changedFiles");
            assertTrue(changed.toString(), changed.contains("drivers/A/config-values.xml") && changed.contains("drivers/B/config-values.xml"));

            Map<String, Object> r = service.pull(live, "lab", List.of(), false, (String) plan.get("revision"), new ArrayList<>(), List.of("drivers/A/config-values.xml"));
            assertEquals(List.of("drivers/A/config-values.xml"), r.get("changedFiles"));
            assertTrue(((Number) r.get("left")).intValue() >= 1);
            DriverSet now = AsCodeReader.read(tree);
            assertTrue(CanonicalXml.serialize(now.driver("A").config.get(Driver.CONFIG_VALUES)).contains("a2"));
            assertTrue("B stays as the branch has it", CanonicalXml.serialize(now.driver("B").config.get(Driver.CONFIG_VALUES)).contains("b1"));
        }
    }

    /** A line-level merge: the vault's change taken in one line, the branch's kept in another; a broken merge is refused. */
    @Test
    @SuppressWarnings("unchecked")
    public void aMergedFileIsWrittenAsMerged() throws Exception {
        Path tree = tmp.newFolder("tree3").toPath();
        AsCodeWriter.write(model("a1", "b1"), tree);
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);
            DriverSet live = model("a2", "b2");
            Map<String, Object> plan = service.pull(live, "lab", List.of(), true, "", new ArrayList<>());
            String file = "drivers/A/config-values.xml";
            String theirs = Files.readString(tree.resolve(file)).replace("a1", "a2");
            String merged = theirs.replace("display-name=\"v\"", "display-name=\"merged\"");
            Map<String, Object> r = service.pull(live, "lab", List.of(), false, (String) plan.get("revision"), new ArrayList<>(),
                List.of(file), Map.of(file, merged));
            assertEquals(List.of(file), r.get("changedFiles"));
            assertEquals(merged, Files.readString(tree.resolve(file)));

            Map<String, Object> again = service.pull(live, "lab", List.of(), true, "", new ArrayList<>());
            try {
                service.pull(live, "lab", List.of(), false, (String) again.get("revision"), new ArrayList<>(), List.of("drivers/B/config-values.xml"),
                    Map.of("drivers/B/config-values.xml", "<configuration-values><definitions>"));
                throw new AssertionError("a broken merge was written");
            } catch (TreeService.BadRequest expected) {
                assertTrue(expected.getMessage(), expected.getMessage().startsWith("with that choice the tree can't be read"));
            }
            assertTrue(Files.readString(tree.resolve("drivers/B/config-values.xml")).contains("b1"));
        }
    }

    /** A choice that leaves the tree unreadable (a manifest naming a file not taken) is refused, and nothing is written. */
    @Test
    @SuppressWarnings("unchecked")
    public void aChoiceThatBreaksTheTreeIsRefused() throws Exception {
        Path tree = tmp.newFolder("tree2").toPath();
        AsCodeWriter.write(model("a1", "b1"), tree);
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);
            DriverSet live = model("a1", "b1");
            live.drivers.remove(live.driver("B"));   // the vault no longer has B: its files go, and the set's manifest changes
            Map<String, Object> plan = service.pull(live, "lab", List.of(), true, "", new ArrayList<>());
            List<String> deleted = (List<String>) plan.get("deletedFiles");
            assertTrue(deleted.toString(), deleted.contains("drivers/B/config-values.xml"));
            try {
                service.pull(live, "lab", List.of(), false, (String) plan.get("revision"), new ArrayList<>(), List.of("drivers/B/config-values.xml"));
                throw new AssertionError("a choice leaving driver.xml naming a missing file was written");
            } catch (TreeService.BadRequest expected) {
                assertTrue(expected.getMessage(), expected.getMessage().startsWith("with that choice the tree can't be read"));
                assertFalse(expected.getMessage(), expected.getMessage().contains(tmp.getRoot().getName()));
            }
            assertTrue("nothing written", Files.exists(tree.resolve("drivers/B/config-values.xml")));
        }
    }

    @Test
    public void aDiscardPutsOneFileBackOrRemovesANewOne() throws Exception {
        Git git = new Git(tmp.newFolder("data").toPath(), null);
        Path repo = tmp.newFolder("repo").toPath();
        Files.writeString(repo.resolve("a.xml"), "<a/>", StandardCharsets.UTF_8);
        Files.writeString(repo.resolve("b.xml"), "<b/>", StandardCharsets.UTF_8);
        assertTrue(git.run(repo, "init", "-q", "-b", "main").ok());
        git.commit(repo, "seed", "me", "me@localhost", false);
        Files.writeString(repo.resolve("a.xml"), "<a changed=\"1\"/>", StandardCharsets.UTF_8);
        Files.writeString(repo.resolve("b.xml"), "<b changed=\"1\"/>", StandardCharsets.UTF_8);
        Files.writeString(repo.resolve("c.xml"), "<c/>", StandardCharsets.UTF_8);

        assertEquals(Boolean.TRUE, git.discard(repo, "a.xml").get("discarded"));
        assertEquals("<a/>", Files.readString(repo.resolve("a.xml")));
        assertEquals("the other change stays", "<b changed=\"1\"/>", Files.readString(repo.resolve("b.xml")));
        git.discard(repo, "c.xml");
        assertFalse(Files.exists(repo.resolve("c.xml")));
        for (String bad : new String[] {"../x", "/etc/passwd", ""}) {
            try {
                git.discard(repo, bad);
                throw new AssertionError("discarded " + bad);
            } catch (TreeService.BadRequest expected) {
                // refused
            }
        }
    }
}
