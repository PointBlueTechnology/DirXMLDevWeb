package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

/** The version the server announces is the pom's — a release bumps both or fails here. */
public class VersionTest {

    @Test
    public void serveVersionIsThePomVersion() throws Exception {
        String pom = Files.readString(Path.of("pom.xml"));
        Matcher m = Pattern.compile("<artifactId>dirxml-dev-web</artifactId>\\s*<version>([^<]+)</version>").matcher(pom);
        if (!m.find()) {
            throw new AssertionError("project version not found in pom.xml");
        }
        assertEquals(m.group(1), Serve.VERSION);
    }
}
