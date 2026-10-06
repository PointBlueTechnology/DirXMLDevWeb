package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.nio.file.Path;
import org.junit.Test;

/** Where the catalog comes from. */
public class PackageServiceTest {

    @Test
    public void theCatalogIsTheOptionThenTheEnvironmentThenNone() {
        assertEquals(Path.of("/a"), PackageService.locate(Path.of("/a"), "/b"));
        assertEquals(Path.of("/b"), PackageService.locate(null, "/b"));
        assertNull(PackageService.locate(null, ""));
        assertNull(PackageService.locate(null, null));
        assertNull(new PackageService(Path.of("."), null).catalogArg());
    }
}
