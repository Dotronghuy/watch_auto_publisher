package vn.zenwatch.mobileworker

import java.net.URLDecoder
import org.junit.Assert.*
import org.junit.Test

class FacebookDirectLinkPolicyTest {
    @Test fun pageVideoRouteComesFirstWithoutProfileTargets() {
        val url = "https://www.facebook.com/101/videos/202/?mibextid=abc"
        val targets = FacebookDirectLinkPolicy.targets("101_202", url, "reel")
        assertEquals("https://www.facebook.com/101/videos/202", targets.first())
        assertTrue(targets.contains(url))
        assertTrue(targets.all { !URLDecoder.decode(it, "UTF-8").contains("profile.php") })
        assertTrue(targets.all { !URLDecoder.decode(it, "UTF-8").contains("sk=posts") })
        assertTrue(targets.any { it.startsWith("fb://facewebmodal/") &&
            URLDecoder.decode(it.substringAfter("href="), "UTF-8") == "https://www.facebook.com/101/videos/202" })
    }

    @Test fun ordinaryPostUsesSuppliedPermalinkFirst() {
        val url = "https://www.facebook.com/101/posts/202"
        assertEquals(url, FacebookDirectLinkPolicy.targets("101_202", url, "post").first())
    }

    @Test fun videoOnlyIdDoesNotRequireAGuessedPage() {
        assertEquals("https://www.facebook.com/reel/202",
            FacebookDirectLinkPolicy.targets("202", "", "reel").first())
    }

    @Test fun reelKeepsOwnerInBothFallbackRepresentations() {
        val targets = FacebookDirectLinkPolicy.targets("101_202", "", "reel")
        assertEquals("https://www.facebook.com/101/videos/202", targets.first())
        assertEquals("https://www.facebook.com/101/videos/202",
            URLDecoder.decode(targets[1].substringAfter("href="), "UTF-8"))
    }

    @Test fun trackingIdCannotRescueWrongVideo() {
        assertEquals("https://www.facebook.com/101/videos/202",
            FacebookDirectLinkPolicy.targets("101_202", "https://www.facebook.com/reel/999?tracking=202", "reel").first())
    }

    @Test fun genericProfileShareWatchAndReelsAreNotDirectTargets() {
        for (url in listOf("https://www.facebook.com/profile.php?id=101",
            "https://www.facebook.com/101/reels/", "https://www.facebook.com/watch",
            "https://www.facebook.com/share/r/abc", "https://fb.watch/abc")) {
            assertEquals("https://www.facebook.com/101/videos/202",
                FacebookDirectLinkPolicy.targets("101_202", url, "reel").first())
        }
    }

    @Test fun postCannotOpenReelOrAnotherPage() {
        for (url in listOf("https://www.facebook.com/reel/202",
            "https://www.facebook.com/999/posts/202",
            "https://www.facebook.com/permalink.php?story_fbid=202&id=999")) {
            assertEquals("https://www.facebook.com/permalink.php?story_fbid=202&id=101",
                FacebookDirectLinkPolicy.targets("101_202", url, "post").first())
        }
    }

    @Test fun foreignHostsCredentialsAndDuplicateIdentityAreRejected() {
        for (url in listOf("https://evil.example/reel/202",
            "https://facebook.com.evil.example/reel/202",
            "https://secret@www.facebook.com/reel/202",
            "https://www.facebook.com/permalink.php?story_fbid=202&id=999&id=101",
            "https://www.facebook.com/permalink.php?story_fbid=202&story_fbid=999&id=101",
            "https://www.facebook.com/watch?v=202&v=999")) {
            assertEquals("https://www.facebook.com/101/videos/202",
                FacebookDirectLinkPolicy.targets("101_202", url, "reel").first())
        }
    }

    @Test fun opaqueOfficialPostCanBeKeptWithoutInventingItsId() {
        val url = "https://www.facebook.com/101/posts/pfbidAbCd"
        assertEquals(url, FacebookDirectLinkPolicy.targets("101_202", url, "post").first())
    }

    @Test fun invalidIdentityOrTypeOpensNothing() {
        assertTrue(FacebookDirectLinkPolicy.targets("", "", "reel").isEmpty())
        assertTrue(FacebookDirectLinkPolicy.targets("101_202", "", "video").isEmpty())
        assertTrue(FacebookDirectLinkPolicy.targets("202", "", "post").isEmpty())
    }
}
