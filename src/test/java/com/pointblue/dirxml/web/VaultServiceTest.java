package com.pointblue.dirxml.web;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.file.Path;
import org.junit.Test;

/** The rule for a write to a vault from the page: the environment's name, given again. */
public class VaultServiceTest {

    @Test
    public void aWriteNeedsTheEnvironmentsNameAndNothingElseWillDo() {
        assertNull(VaultService.gate("lab", "lab"));
        assertNotNull(VaultService.gate("lab", null));
        assertNotNull(VaultService.gate("lab", ""));
        assertNotNull(VaultService.gate("lab", "prod"));
        assertNotNull(VaultService.gate("lab", "LAB"));
        assertTrue(VaultService.gate("lab", null).contains("'lab'"));
    }

    @Test
    public void anUnknownDriverActionIsRefusedBeforeAnyEnvironmentIsRead() throws Exception {
        VaultService vault = new VaultService(Path.of("."), EnvFiles.single(Path.of("no-such-environments.properties")));
        try {
            vault.lifecycle("lab", "Loop", "explode", "lab");
            fail("expected a refusal");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage().contains("start, stop or restart"));
        }
        try {
            vault.lifecycle("lab", "", "start", "lab");
            fail("expected a refusal");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage().contains("driver"));
        }
    }
}
