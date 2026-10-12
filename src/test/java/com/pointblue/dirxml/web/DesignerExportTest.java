package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The project zip round trip (#66): what an upload may unpack to, where its project is, and the zip handed back. */
public class DesignerExportTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static byte[] zip(String... namesAndContents) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(b)) {
            for (int i = 0; i < namesAndContents.length; i += 2) {
                z.putNextEntry(new ZipEntry(namesAndContents[i]));
                z.write(namesAndContents[i + 1].getBytes(StandardCharsets.UTF_8));
                z.closeEntry();
            }
        }
        return b.toByteArray();
    }

    @Test
    public void anEntryOutsideTheFolderIsRefused() throws Exception {
        for (String bad : new String[] {"../escape.txt", "a/../../escape.txt"}) {
            Path to = tmp.newFolder().toPath().resolve("in");
            try {
                DesignerExport.unzip(new ByteArrayInputStream(zip(bad, "x")), to);
                fail("unpacked " + bad);
            } catch (TreeService.BadRequest expected) {
                assertTrue(expected.getMessage().contains("outside"));
            }
            assertFalse(Files.exists(to.getParent().resolve("escape.txt")));
            assertFalse(Files.exists(to.getParent().getParent().resolve("escape.txt")));
        }
    }

    @Test
    public void somethingThatIsNotAZipIsRefused() throws Exception {
        try {
            DesignerExport.unzip(new ByteArrayInputStream("not a zip".getBytes(StandardCharsets.UTF_8)), tmp.newFolder().toPath().resolve("in"));
            fail("accepted a non-zip");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage().contains("not a zip"));
        }
    }

    @Test
    public void theProjectIsAtTheRootOrInTheOneFolder() throws Exception {
        Path a = tmp.newFolder("a").toPath();
        DesignerExport.unzip(new ByteArrayInputStream(zip(".project", "<p/>", "Model/x.txt", "x")), a);
        assertEquals(a, DesignerExport.projectRoot(a));

        Path b = tmp.newFolder("b").toPath();
        DesignerExport.unzip(new ByteArrayInputStream(zip("MyProj/.project", "<p/>", "MyProj/Model/x.txt", "x", "__MACOSX/MyProj/._x", "y")), b);
        assertEquals(b.resolve("MyProj"), DesignerExport.projectRoot(b));

        Path c = tmp.newFolder("c").toPath();
        DesignerExport.unzip(new ByteArrayInputStream(zip("One/.project", "<p/>", "Two/.project", "<p/>")), c);
        try {
            DesignerExport.projectRoot(c);
            fail("chose one of two projects");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage().contains("no Designer project"));
        }
    }

    @Test
    public void theZipHandedBackHasTheProjectFolderAtItsRoot() throws Exception {
        Path dir = tmp.newFolder("work", "MyProj").toPath();
        Files.writeString(dir.resolve(".project"), "<p/>");
        Files.createDirectories(dir.resolve("Model/Sub"));
        Files.writeString(dir.resolve("Model/Sub/a.txt"), "a");
        Path out = tmp.getRoot().toPath().resolve("out.zip");
        DesignerExport.zipDir(dir, out);
        List<String> names = new ArrayList<>();
        try (InputStream in = Files.newInputStream(out); ZipInputStream z = new ZipInputStream(in)) {
            for (ZipEntry e = z.getNextEntry(); e != null; e = z.getNextEntry()) {
                names.add(e.getName());
            }
        }
        assertTrue(names.toString(), names.contains("MyProj/.project"));
        assertTrue(names.toString(), names.contains("MyProj/Model/Sub/a.txt"));
        assertTrue(names.toString(), names.stream().allMatch(n -> n.startsWith("MyProj/")));
    }

    @Test
    public void aHostedWriteStaysUnderTheRoots() throws Exception {
        Path root = tmp.newFolder("srv").toPath();
        DesignerExport d = new DesignerExport(tmp.newFolder("tree").toPath(), null);
        for (String bad : new String[] {"/etc/proj", root + "/../elsewhere/proj"}) {
            try {
                d.toPath("new", bad, true, null, List.of(root));
                fail("wrote outside the roots: " + bad);
            } catch (TreeService.BadRequest expected) {
                assertTrue(expected.getMessage().contains("outside"));
            }
        }
    }

    @Test
    public void aDownloadNameIsSafe() {
        assertEquals("My Set-1.0", DesignerExport.safeName("My Set-1.0"));
        assertEquals("a-b", DesignerExport.safeName("a\"b"));
        assertEquals("export", DesignerExport.safeName("\"\""));
    }
}
