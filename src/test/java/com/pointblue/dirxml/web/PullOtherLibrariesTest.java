package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.pointblue.dirxml.dev.ascode.AsCodeReader;
import com.pointblue.dirxml.dev.ascode.AsCodeWriter;
import com.pointblue.dirxml.dev.model.Driver;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.model.DuplicateArtifacts;
import com.pointblue.dirxml.dev.model.Policy;
import com.pointblue.dirxml.dev.model.PolicyLink;
import com.pointblue.dirxml.dev.model.PolicySet;
import com.pointblue.dirxml.dev.model.Scope;
import com.pointblue.dirxml.dev.xml.CanonicalXml;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Update this branch from a vault whose drivers link Libraries outside the driver set (DirXMLDev #115): the tree keeps
 * its folder names for them, and updating one driver brings in the other-Library objects it links that the tree lacks.
 */
public class PullOtherLibrariesTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static final String DS_DN = "cn=Set,o=system";
    private static final String SHARED = "cn=Library,ou=shared,o=system";
    private static final String ODD = "ou=policies,o=x";

    private static Policy policy(String name, String libraryDn, String alias) {
        Policy p = new Policy(name, Scope.LIBRARY, null, CanonicalXml.parse(
            "<policy><rule><description>" + name + "</description><conditions/><actions/></rule></policy>").getDocumentElement());
        p.meta.put(DuplicateArtifacts.LIBRARY_DN, libraryDn);
        p.library = alias;
        return p;
    }

    private static Driver driver(String name, String... refs) {
        Driver d = new Driver(name);
        d.dn = "cn=" + name + "," + DS_DN;
        d.shimClass = "com.example.Shim";
        int order = 0;
        for (String ref : refs) {
            d.links.add(new PolicyLink(PolicySet.SUB_EVENT, ref, order++));
        }
        return d;
    }

    /** The tree: SHARED in the folder the LDIF import named it, Library@shared, with P; AD links P, Payroll nothing. */
    private Path tree() throws Exception {
        DriverSet ds = new DriverSet("Set");
        ds.dn = DS_DN;
        ds.libraries.put("Library@shared", SHARED);
        ds.library.policies.add(policy("P", SHARED, "Library@shared"));
        ds.drivers.add(driver("AD", "libraries/Library@shared/P"));
        ds.drivers.add(driver("Payroll"));
        Path tree = tmp.newFolder("tree").toPath();
        AsCodeWriter.write(ds, tree);
        return tree;
    }

    /** The vault as a read sees it: SHARED alone, so aliased Library, and AD now links Q there; Payroll links Odd in an ou. */
    private static DriverSet live() {
        DriverSet live = new DriverSet("Set");
        live.dn = DS_DN;
        live.libraries.put("Library", SHARED);
        live.libraries.put("policies", ODD);
        live.library.policies.add(policy("P", SHARED, "Library"));
        live.library.policies.add(policy("Q", SHARED, "Library"));
        live.library.policies.add(policy("Odd", ODD, "policies"));
        live.drivers.add(driver("AD", "libraries/Library/P", "libraries/Library/Q"));
        live.drivers.add(driver("Payroll", "libraries/policies/Odd"));
        return live;
    }

    @Test
    @SuppressWarnings("unchecked")
    public void aWholeUpdateKeepsTheTreesFolderNames() throws Exception {
        Path tree = tree();
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);
            Map<String, Object> plan = service.pull(live(), "QA", List.of(), true, "", new ArrayList<>());
            List<String> changed = (List<String>) plan.get("changedFiles");
            List<String> deleted = (List<String>) plan.get("deletedFiles");
            assertFalse("no folder under the read's alias " + changed, changed.stream().anyMatch(f -> f.startsWith("libraries/Library/")));
            assertFalse("the tree's folder stays " + deleted, deleted.stream().anyMatch(f -> f.startsWith("libraries/Library@shared/")));

            service.pull(live(), "QA", List.of(), false, (String) plan.get("revision"), new ArrayList<>());
            DriverSet now = AsCodeReader.read(tree);
            assertEquals(SHARED, now.libraries.get("Library@shared"));
            assertNotNull(now.resolve("libraries/Library@shared/Q"));
            assertTrue(now.unresolvedLinks().toString(), now.unresolvedLinks().isEmpty());
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    public void updatingOneDriverBringsInWhatItLinks() throws Exception {
        Path tree = tree();
        byte[] p = Files.readAllBytes(tree.resolve(firstFile(tree, "libraries/Library@shared", "P")));
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);

            // AD: Q joins the tree's folder for SHARED; P is left as it is
            List<String> notes = new ArrayList<>();
            Map<String, Object> plan = service.pull(live(), "QA", List.of("AD"), true, "", notes);
            List<String> changed = (List<String>) plan.get("changedFiles");
            assertTrue(changed.toString(), changed.stream().anyMatch(f -> f.startsWith("libraries/Library@shared/Q")));
            assertFalse(changed.toString(), changed.stream().anyMatch(f -> f.startsWith("libraries/Library@shared/P")));
            assertFalse(changed.toString(), changed.stream().anyMatch(f -> f.startsWith("libraries/policies/")));
            service.pull(live(), "QA", List.of("AD"), false, (String) plan.get("revision"), new ArrayList<>());
            DriverSet now = AsCodeReader.read(tree);
            assertNotNull(now.resolve("libraries/Library@shared/Q"));
            assertTrue(now.unresolvedLinks().toString(), now.unresolvedLinks().isEmpty());
            assertEquals(new String(p), new String(Files.readAllBytes(tree.resolve(firstFile(tree, "libraries/Library@shared", "P")))));

            // Payroll: a container the tree has no folder for gets one, in the manifest too
            notes.clear();
            plan = service.pull(live(), "QA", List.of("Payroll"), true, "", notes);
            changed = (List<String>) plan.get("changedFiles");
            assertTrue(changed.toString(), changed.stream().anyMatch(f -> f.startsWith("libraries/policies/Odd")));
            assertTrue(notes.toString(), notes.stream().anyMatch(n -> n.startsWith("libraries/policies: " + ODD)));
            service.pull(live(), "QA", List.of("Payroll"), false, (String) plan.get("revision"), new ArrayList<>());
            now = AsCodeReader.read(tree);
            assertEquals(ODD, now.libraries.get("policies"));
            assertNotNull(now.resolve("libraries/policies/Odd"));
            assertTrue(now.unresolvedLinks().toString(), now.unresolvedLinks().isEmpty());
        }
    }

    /** The file an artifact named {@code name} was written to in {@code dir}, relative to the tree. */
    private static String firstFile(Path tree, String dir, String name) throws Exception {
        try (java.util.stream.Stream<Path> s = Files.list(tree.resolve(dir))) {
            return tree.relativize(s.filter(f -> f.getFileName().toString().startsWith(name + "."))
                .findFirst().orElseThrow(() -> new AssertionError("no file for " + name + " in " + dir))).toString();
        }
    }
}
