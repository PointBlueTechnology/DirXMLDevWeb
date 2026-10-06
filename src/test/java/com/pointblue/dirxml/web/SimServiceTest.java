package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Where the corpus is, and that a case name cannot reach outside it. */
public class SimServiceTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void theCorpusIsBesideTheTreeUnlessOnlyTheTreeHoldsOne() throws Exception {
        Path tree = tmp.newFolder("work", "tree").toPath();
        assertEquals(tree.resolveSibling("cases"), SimService.locate(tree, null));
        Files.createDirectories(tree.resolve("cases"));
        assertEquals(tree.resolve("cases"), SimService.locate(tree, null));
        Files.createDirectories(tree.resolveSibling("cases"));
        assertEquals(tree.resolveSibling("cases"), SimService.locate(tree, null));
        assertEquals(Path.of("/elsewhere"), SimService.locate(tree, Path.of("/elsewhere")));
    }

    @Test
    public void aCaseNameStaysInsideTheCorpus() throws Exception {
        Path tree = tmp.newFolder("tree").toPath();
        SimService sim = new SimService(tree, tmp.getRoot().toPath().resolve("cases"));
        for (String bad : new String[] {"../x", "/abs", "a/../b", "a//b", "", ".hidden", "a b"}) {
            try {
                sim.save(bad, "Loop", "subscriber", "<a/>");
                fail("accepted '" + bad + "'");
            } catch (TreeService.BadRequest expected) {
                assertTrue(expected.getMessage().contains("case name"));
            }
        }
        assertTrue(sim.list().get("cases").toString().equals("[]"));
    }
}
