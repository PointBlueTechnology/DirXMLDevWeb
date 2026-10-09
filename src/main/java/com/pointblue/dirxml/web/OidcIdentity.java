package com.pointblue.dirxml.web;

import com.pointblue.console.auth.OidcClient;
import com.pointblue.console.auth.OidcConfig;
import com.pointblue.console.auth.OidcException;
import com.pointblue.console.auth.TrustManagers;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.util.List;
import java.util.Map;
import javax.net.ssl.SSLContext;

/**
 * OpenID Connect sign-in with discovery (Keycloak, Entra ID, Okta, OSP), configured from the
 * hosted properties ({@code oidc.*}). The protocol — authorization code with PKCE, ID-token
 * verification against the provider's JWKS, the groups claim — is console-auth's
 * {@link OidcClient}; this class maps it onto {@code /auth/login} and {@code /auth/callback} and
 * turns the verified person into a principal with the hosted roles.
 */
public final class OidcIdentity implements Identity {

    private final Hosted hosted;
    private final OidcClient client;

    public OidcIdentity(Hosted hosted) throws IOException {
        this.hosted = hosted;
        String ca = hosted.props.getProperty("oidc.caFile");
        SSLContext tls = null;
        if (ca != null && !ca.isBlank()) {
            try {
                tls = TrustManagers.sslContext(TrustManagers.jdkPlus(Path.of(ca.trim())));
            } catch (GeneralSecurityException e) {
                throw new IOException("oidc.caFile " + ca.trim() + ": " + e.getMessage(), e);
            }
        }
        this.client = new OidcClient(new OidcConfig(need(hosted, "oidc.issuer"), need(hosted, "oidc.clientId"),
            hosted.secret("oidc.clientSecret"), hosted.props.getProperty("oidc.scopes"), hosted.props.getProperty("oidc.groupsClaim"),
            hosted.publicUrl + "/auth/callback", tls));
    }

    private static String need(Hosted h, String key) {
        String v = h.props.getProperty(key);
        if (v == null || v.isBlank()) {
            throw new IllegalArgumentException("identity=oidc needs " + key);
        }
        return v.trim();
    }

    @Override
    public String name() {
        return "oidc";
    }

    @Override
    public void login(HttpExchange ex, String next) throws IOException {
        Auth.redirect(ex, client.start(next).url());
    }

    @Override
    public Session.Principal callback(HttpExchange ex) throws IOException {
        Map<String, String> q = Api.query(ex.getRequestURI().getRawQuery());
        OidcClient.SignIn s;
        try {
            s = client.finish(q);
        } catch (OidcException e) {
            throw new TreeService.BadRequest(e.getMessage());
        }
        ex.setAttribute("next", s.next());
        return hosted.principal(s.subject(), s.name(), s.email(), s.groups());
    }

    /** The groups claim at the configured dotted path ({@code oidc.groupsClaim}). */
    List<String> groups(Map<String, Object> claims) {
        return client.groups(claims);
    }
}
