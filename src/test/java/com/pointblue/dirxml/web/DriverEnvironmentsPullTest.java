package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
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
 * Update this branch from an environment whose vault holds other drivers, or names one differently: the tree keeps the
 * drivers that environment doesn't get, a renamed driver comes back under the tree's name, and a driver new to a shared
 * tree is marked as that environment's only.
 */
public class DriverEnvironmentsPullTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static Driver driver(String name, String value) {
        Driver d = new Driver(name);
        d.dn = "cn=" + name + ",cn=Set,o=system";
        d.shimClass = "com.example.Shim";
        d.config.put(Driver.CONFIG_VALUES, CanonicalXml.parse("<configuration-values><definitions><definition display-name=\"v\" name=\"v\" type=\"string\"><value>"
            + value + "</value></definition></definitions></configuration-values>").getDocumentElement());
        return d;
    }

    @Test
    @SuppressWarnings("unchecked")
    public void anUpdateFollowsTheTreesNamesAndEnvironments() throws Exception {
        Path tree = tmp.newFolder("tree").toPath();
        DriverSet ds = new DriverSet("Set");
        ds.dn = "cn=Set,o=system";
        ds.drivers.add(driver("AD", "a1"));
        Driver prodOnly = driver("Payroll", "p1");
        prodOnly.environments.add("PROD");
        ds.drivers.add(prodOnly);
        AsCodeWriter.write(ds, tree);
        Files.createDirectories(tree.resolve("overrides"));
        Files.writeString(tree.resolve("overrides/QA.properties"), "drivers/AD.name = AD-QA\n", StandardCharsets.UTF_8);

        // QA's vault: AD under another name, no Payroll, and a loopback the tree doesn't have
        DriverSet qa = new DriverSet("Set");
        qa.dn = "cn=Set,o=system";
        qa.drivers.add(driver("AD-QA", "a1"));
        qa.drivers.add(driver("QA Loopback", "l1"));

        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);
            List<String> notes = new ArrayList<>();
            Map<String, Object> plan = service.pull(qa, "QA", List.of(), true, "", notes, null, null, true);
            List<String> changed = (List<String>) plan.get("changedFiles");
            List<String> deleted = (List<String>) plan.get("deletedFiles");
            assertFalse("Payroll stays: QA doesn't get it " + deleted, deleted.stream().anyMatch(f -> f.startsWith("drivers/Payroll/")));
            assertFalse("AD keeps its folder " + deleted, deleted.stream().anyMatch(f -> f.startsWith("drivers/AD/")));
            assertFalse("no folder under QA's name " + changed, changed.stream().anyMatch(f -> f.startsWith("drivers/AD-QA/")));
            assertTrue(changed.toString(), changed.contains("drivers/QA Loopback/driver.xml"));
            assertTrue(notes.toString(), notes.stream().anyMatch(n -> n.contains("new to the tree")));

            service.pull(qa, "QA", List.of(), false, (String) plan.get("revision"), new ArrayList<>(), null, null, true);
            DriverSet now = AsCodeReader.read(tree);
            assertNotNull(now.driver("AD"));
            assertNull(now.driver("AD-QA"));
            assertEquals(List.of("PROD"), now.driver("Payroll").environments);
            assertEquals(List.of("QA"), now.driver("QA Loopback").environments);
            assertEquals("the tree's recorded DN", "cn=AD,cn=Set,o=system", now.driver("AD").dn);

            // updating just Payroll from QA, which doesn't get it, is refused
            try {
                service.pull(qa, "QA", List.of("Payroll"), true, "", new ArrayList<>(), null, null, true);
                throw new AssertionError("an update of a driver QA doesn't get was accepted");
            } catch (TreeService.BadRequest expected) {
                assertTrue(expected.getMessage(), expected.getMessage().contains("not deployed to QA"));
            }
        }
    }
}
