package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.pointblue.dirxml.dev.edit.Operation;
import com.pointblue.dirxml.dev.edit.Transaction;
import com.pointblue.dirxml.dev.model.DriverSet;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Several operations as one change, and the throwaway copy a preview runs against. */
public class BatchTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static Operation op(String name, List<String> log, String refuse) {
        return new Operation() {
            @Override
            public String name() {
                return name;
            }

            @Override
            public void apply(DriverSet ds, Transaction tx) throws Refusal {
                if (refuse != null) {
                    throw new Refusal(refuse);
                }
                log.add(name);
            }
        };
    }

    @Test
    public void membersApplyInOrder_andOneNameIsKeptForOne() throws Exception {
        List<String> log = new ArrayList<>();
        Batch b = new Batch(List.of(op("a", log, null), op("b", log, null), op("c", log, null)));
        b.apply(null, null);
        assertEquals(List.of("a", "b", "c"), log);
        assertEquals("batch(3)", b.name());
        assertEquals("gcv.set", new Batch(List.of(op("gcv.set", log, null))).name());
    }

    @Test
    public void aRefusalSaysWhichChangeAndStopsTheRest() throws Exception {
        List<String> log = new ArrayList<>();
        Batch b = new Batch(List.of(op("a", log, null), op("b", log, "no such driver"), op("c", log, null)));
        try {
            b.apply(null, null);
            fail("expected a refusal");
        } catch (Operation.Refusal r) {
            assertEquals("change 2 of 3 (b): no such driver", r.getMessage());
        }
        assertEquals("nothing after the refusal ran", List.of("a"), log);
    }

    @Test
    public void thePreviewCopyHoldsTheTreesContentAndNothingElse() throws Exception {
        Path tree = tmp.newFolder("tree").toPath();
        Files.writeString(tree.resolve("driverset.xml"), "<driverset/>", StandardCharsets.UTF_8);
        Files.createDirectories(tree.resolve("drivers/AD"));
        Files.writeString(tree.resolve("drivers/AD/driver.xml"), "<driver/>", StandardCharsets.UTF_8);
        Files.createDirectories(tree.resolve("overrides"));
        Files.writeString(tree.resolve("overrides/prd.properties"), "k = v\n", StandardCharsets.UTF_8);
        for (String skipped : List.of(".git", "deploy-snapshots/stg", "deploy-log")) {
            Files.createDirectories(tree.resolve(skipped));
            Files.writeString(tree.resolve(skipped).resolve("x"), "x", StandardCharsets.UTF_8);
        }
        Path copy = tmp.newFolder("copy").toPath();
        TreeService.copyTree(tree, copy);
        assertTrue(Files.isRegularFile(copy.resolve("driverset.xml")));
        assertTrue(Files.isRegularFile(copy.resolve("drivers/AD/driver.xml")));
        assertEquals("k = v\n", Files.readString(copy.resolve("overrides/prd.properties")));
        assertFalse(Files.exists(copy.resolve(".git")));
        assertFalse(Files.exists(copy.resolve("deploy-snapshots")));
        assertFalse(Files.exists(copy.resolve("deploy-log")));
        TreeService.deleteTree(copy);
        assertFalse(Files.exists(copy));
    }
}
