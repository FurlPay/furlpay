package com.furlpay.guardian.network

import com.furlpay.guardian.network.dto.AssetDetailResponse
import com.furlpay.guardian.network.dto.BarsResponse
import com.furlpay.guardian.network.dto.BookRequest
import com.furlpay.guardian.network.dto.BookResponse
import com.furlpay.guardian.network.dto.CardSettingsRequest
import com.furlpay.guardian.network.dto.CardSettingsResponse
import com.furlpay.guardian.network.dto.CardsResponse
import com.furlpay.guardian.network.dto.DealsResponse
import com.furlpay.guardian.network.dto.FlightSearchRequest
import com.furlpay.guardian.network.dto.FlightSearchResponse
import com.furlpay.guardian.network.dto.HotelsSearchResponse
import com.furlpay.guardian.network.dto.MarketsResponse
import com.furlpay.guardian.network.dto.OrderRequest
import com.furlpay.guardian.network.dto.OrderResponse
import com.furlpay.guardian.network.dto.OtpCheckRequest
import com.furlpay.guardian.network.dto.OtpCheckResponse
import com.furlpay.guardian.network.dto.OtpStartRequest
import com.furlpay.guardian.network.dto.PortfolioResponse
import com.furlpay.guardian.network.dto.RegisterDeviceRequest
import com.furlpay.guardian.network.dto.RegisterDeviceResponse
import com.furlpay.guardian.network.dto.TransactionsResponse
import com.furlpay.guardian.network.dto.TripsResponse
import com.furlpay.guardian.network.dto.WalletsResponse
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Url

/**
 * The furlpay.com/api surface Guardian uses. Paths are relative — they resolve
 * under the client's base URL (`https://furlpay.com/api/`), so MockWebServer
 * swaps in transparently for tests.
 */
interface FurlPayApi {

    @GET("wallets")
    suspend fun wallets(): WalletsResponse

    @GET("cards")
    suspend fun cards(): CardsResponse

    @POST("cards/settings")
    suspend fun cardSettings(@Body body: CardSettingsRequest): CardSettingsResponse

    @GET("transactions")
    suspend fun transactions(): TransactionsResponse

    @GET("investing/portfolio")
    suspend fun portfolio(): PortfolioResponse

    @GET("travel/trips")
    suspend fun trips(): TripsResponse

    @GET("markets")
    suspend fun markets(
        @Query("kind") kind: String? = null,
        @Query("limit") limit: Int? = null,
        @Query("sort") sort: String? = null,
    ): MarketsResponse

    // Native PriceChart contract: tf in 1D|1W|1M|3M|1Y|ALL.
    @GET("markets/bars")
    suspend fun bars(
        @Query("symbol") symbol: String,
        @Query("tf") tf: String,
    ): BarsResponse

    @GET("markets/{symbol}")
    suspend fun asset(@Path("symbol") symbol: String): AssetDetailResponse

    // Fractional notional order — native market/[symbol].tsx placeOrder.
    @POST("investing/order")
    suspend fun placeOrder(@Body body: OrderRequest): OrderResponse

    @GET("travel/deals")
    suspend fun travelDeals(): DealsResponse

    @GET("travel/hotels")
    suspend fun travelHotels(@Query("city") city: String): HotelsSearchResponse

    @POST("travel/search")
    suspend fun searchFlights(@Body body: FlightSearchRequest): FlightSearchResponse

    @POST("travel/book")
    suspend fun bookStay(@Body body: BookRequest): BookResponse

    @POST("push/devices")
    suspend fun registerDevice(@Body body: RegisterDeviceRequest): RegisterDeviceResponse

    // Anonymous (no bearer yet) — the interceptor simply finds no stored token.
    @POST("auth/otp/start")
    suspend fun otpStart(@Body body: OtpStartRequest): JsonObject

    @POST("auth/otp/check")
    suspend fun otpCheck(@Body body: OtpCheckRequest): OtpCheckResponse

    /**
     * Registry-dispatched action. ONLY [ActionDispatcher] may call this — the
     * endpoint must come from a [com.furlpay.guardian.domain.action.ResolvedConfirmation.Ok],
     * never from model output directly.
     */
    @POST
    suspend fun dispatch(@Url endpoint: String, @Body body: JsonObject): JsonObject
}
