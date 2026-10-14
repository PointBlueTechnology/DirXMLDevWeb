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

    /** #109's finding: the one-person container (public.url http://localhost:8080) also answers as 127.0.0.1 and [::1]. */
    @Test
    public void aHostedServerOnLoopbackAnswersToEachLoopbackName() {
        Security h = Security.hosted("http://localhost:8080");
        assertNull(h.refuse("localhost:8080", null, null));
        assertNull(h.refuse("127.0.0.1:8080", "http://127.0.0.1:8080", null));
        assertNull(h.refuse("[::1]:8080", "http://[::1]:8080", null));
        assertNull(h.refuse("LOCALHOST:8080", "http://LocalHost:8080", null));
        assertNotNull("another port", h.refuse("127.0.0.1:9999", null, null));
        assertNotNull("a rebinding name", h.refuse("evil.example:8080", null, null));
        assertNotNull("another origin", h.refuse("127.0.0.1:8080", "http://evil.example:8080", null));
        assertNotNull("another scheme", h.refuse("127.0.0.1:8080", "https://127.0.0.1:8080", null));
    }

    /** A team server answers only to its public name, never to a loopback one. */
    @Test
    public void aHostedServerOnAPublicNameAnswersOnlyToIt() {
        Security h = Security.hosted("https://idm.example.com");
        assertNull(h.refuse("idm.example.com", "https://idm.example.com", null));
        assertNotNull(h.refuse("localhost", null, null));
        assertNotNull(h.refuse("127.0.0.1", null, null));
        assertNotNull(h.refuse("idm.example.com", "http://idm.example.com", null));
    }
}
