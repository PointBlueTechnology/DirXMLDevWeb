package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** The three gates on a request: this host, this origin, this session's token. */
public class SecurityTest {

    private final Security s = new Security("secret-token", 8123);

    @Test
    public void theRightHostOriginAndTokenPass() {
        assertNull(s.refuse("127.0.0.1:8123", null, "secret-token"));
        assertNull(s.refuse("localhost:8123", "http://localhost:8123", "secret-token"));
        assertNull(s.refuse("127.0.0.1:8123", "http://127.0.0.1:8123", "secret-token"));
    }

    @Test
    public void aReboundHostIsRefused() {
        assertNotNull(s.refuse("evil.example:8123", null, "secret-token"));
        assertNotNull(s.refuse("127.0.0.1:9999", null, "secret-token"));
        assertNotNull(s.refuse(null, null, "secret-token"));
    }

    @Test
    public void anotherOriginIsRefused() {
        assertNotNull(s.refuse("127.0.0.1:8123", "https://evil.example", "secret-token"));
        assertNotNull(s.refuse("127.0.0.1:8123", "http://127.0.0.1:9999", "secret-token"));
    }

    @Test
    public void aMissingOrWrongTokenIsRefused() {
        assertNotNull(s.refuse("127.0.0.1:8123", null, null));
        assertNotNull(s.refuse("127.0.0.1:8123", null, "secret-toke"));
        assertNotNull(s.refuse("127.0.0.1:8123", null, ""));
    }

    @Test
    public void tokensAreLongAndDifferent() {
        String a = Security.newToken();
        assertEquals(48, a.length());
        assertNotEquals(a, Security.newToken());
    }
}
