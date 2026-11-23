package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.pointblue.dirxml.dev.ascode.AsCodeWriter;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.model.DuplicateArtifacts;
import com.pointblue.dirxml.dev.model.Libraries;
import com.pointblue.dirxml.dev.model.Resource;
import com.pointblue.dirxml.dev.model.Scope;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** A Library object from another Library is shown read-only: the outline, the Developer tree, the artifact (DirXMLDev #111). */
public class ReadOnlyLibraryTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static final String SHARED = "cn=Library,ou=shared,o=system";

    private static Resource js(String name) {
        Resource r = new Resource(name, Scope.LIBRARY, null, Resource.ECMASCRIPT);
        r.text = "function " + name.replace('-', '_') + "(){}";
        return r;
    }

    @Test
    @SuppressWarnings("unchecked")
    public void theOtherLibrarysObjectIsReadOnly() throws Exception {
        DriverSet ds = new DriverSet("DS");
        ds.dn = "cn=DS,o=system";
        ds.library.resources.add(js("es-own"));
        Resource shared = js("es-shared");
        shared.meta.put(DuplicateArtifacts.LIBRARY_DN, SHARED);
        ds.library.resources.add(shared);
        Path tree = tmp.newFolder("tree").toPath();
        AsCodeWriter.write(ds, tree);
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);

            Map<String, Object> other = service.artifact("library/es-shared");
            assertEquals(SHARED, other.get("readOnly"));
            assertEquals(false, other.get("editable"));
            Map<String, Object> own = service.artifact("library/es-own");
            assertNull(own.get("readOnly"));
            assertEquals(true, own.get("editable"));

            List<Map<String, Object>> resources = (List<Map<String, Object>>) ((Map<String, Object>) service.outline().get("library")).get("resources");
            for (Map<String, Object> n : resources) {
                assertEquals(n.get("name").equals("es-shared") ? SHARED : null, n.get("readOnly"));
            }
            String dev = String.valueOf(service.developer());
            assertTrue(dev, dev.contains("readOnly=" + SHARED));
            assertFalse(dev.contains("readOnly=null"));
        }
    }

    /** Each other Library in a folder of its own (DirXMLDev 0.77.0): the outline lists it, the Developer tree groups by it. */
    @Test
    @SuppressWarnings("unchecked")
    public void eachOtherLibraryIsAGroupOfItsOwn() throws Exception {
        DriverSet ds = new DriverSet("DS");
        ds.dn = "cn=DS,o=system";
        ds.library.resources.add(js("es-misc"));
        Resource shared = js("es-misc");   // one name in two Libraries: both kept
        shared.meta.put(DuplicateArtifacts.LIBRARY_DN, SHARED);
        ds.library.resources.add(shared);
        Libraries.assignAliases(ds, List.of("cn=links-only,o=system"));
        String alias = Libraries.aliasOf(ds, SHARED);
        Path tree = tmp.newFolder("tree").toPath();
        AsCodeWriter.write(ds, tree);
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);
            Map<String, Object> outline = service.outline();

            List<Map<String, Object>> libraries = (List<Map<String, Object>>) outline.get("libraries");
            assertEquals(2, libraries.size());
            Map<String, Object> pub = libraries.stream().filter(l -> alias.equals(l.get("alias"))).findFirst().orElseThrow();
            assertEquals(SHARED, pub.get("dn"));
            assertEquals(1, pub.get("items"));
            assertEquals(0, libraries.stream().filter(l -> !alias.equals(l.get("alias"))).findFirst().orElseThrow().get("items"));

            List<Map<String, Object>> resources = (List<Map<String, Object>>) ((Map<String, Object>) outline.get("library")).get("resources");
            assertEquals(2, resources.size());
            for (Map<String, Object> n : resources) {
                boolean other = n.get("library") != null;
                assertEquals(other ? "libraries/" + alias + "/es-misc" : "library/es-misc", n.get("path"));
                assertEquals(other ? SHARED : null, n.get("readOnly"));
            }
            assertEquals(SHARED, service.artifact("libraries/" + alias + "/es-misc").get("readOnly"));

            Map<String, Object> dev = service.developer();
            List<Map<String, Object>> top = (List<Map<String, Object>>) ((Map<String, Object>) dev.get("root")).get("children");
            Map<String, Object> folder = top.stream().filter(n -> ("library:" + alias).equals(n.get("id"))).findFirst().orElseThrow();
            assertEquals(TreeService.libraryTitle(alias), folder.get("label"));
            assertEquals("Library@shared", TreeService.libraryTitle("Library@shared"));
            assertEquals("Library pub", TreeService.libraryTitle("pub"));
            assertEquals(SHARED, folder.get("readOnly"));
            assertEquals(1, ((List<Object>) folder.get("children")).size());
            Map<String, Object> own = top.stream().filter(n -> "library".equals(n.get("id"))).findFirst().orElseThrow();
            assertEquals(1, ((List<Object>) own.get("children")).size());
            // a container only links reach has no objects, so no folder
            assertEquals(1, top.stream().filter(n -> String.valueOf(n.get("id")).startsWith("library:")).count());
        }
    }
}
