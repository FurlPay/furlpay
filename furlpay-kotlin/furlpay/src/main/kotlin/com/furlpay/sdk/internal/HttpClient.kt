package com.furlpay.sdk.internal

import com.furlpay.sdk.errors.AuthenticationException
import com.furlpay.sdk.errors.NetworkException
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

internal class FurlPayHttpClient(
    private val apiKey: String,
    private val baseUrl: String
) {
    private val json = Json { ignoreUnknownKeys = true }

    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) {
            json(json)
        }
        defaultRequest {
            header("Authorization", "Bearer $apiKey")
            contentType(ContentType.Application.Json)
        }
    }

    suspend inline fun <reified T> request(
        method: HttpMethod,
        path: String,
        body: Any? = null
    ): T {
        try {
            val response: HttpResponse = client.request("$baseUrl$path") {
                this.method = method
                if (body != null) {
                    setBody(body)
                }
            }

            if (!response.status.isSuccess()) {
                if (response.status.value == 401) {
                    throw AuthenticationException("Invalid API key")
                }
                throw NetworkException("API error: ${response.status.value} - ${response.bodyAsText()}")
            }

            val responseBody = response.bodyAsText()
            return json.decodeFromString(responseBody)
        } catch (e: Exception) {
            if (e is AuthenticationException || e is NetworkException) throw e
            throw NetworkException("Network request failed", e)
        }
    }
}
