namespace functions;

using System.Text;
using System.Text.Json;
using Atlas.Domain;
using Microsoft.Extensions.Configuration;

public class BroadcastRelay
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;

    public BroadcastRelay(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _configuration = configuration;
    }

    public async Task BroadcastAsync(ProductionResponse snapshot)
    {
        var url = _configuration["BroadcastUrl"];
        var apiKey = _configuration["BroadcastKey"];

        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(apiKey))
        {
            return;
        }

        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(snapshot), Encoding.UTF8, "application/json")
        };
        request.Headers.Add("X-Api-Key", apiKey);

        try
        {
            var response = await _httpClient.SendAsync(request);
            response.EnsureSuccessStatusCode();
        }
        catch (Exception)
        {
            // Logging handled by caller
        }
    }
}

