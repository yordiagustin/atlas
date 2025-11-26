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

    public async Task BroadcastAsync(string date, string shiftKey, ShiftLog? log)
    {
        var url = _configuration["BroadcastUrl"];
        var apiKey = _configuration["BroadcastKey"];

        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(apiKey))
        {
            return;
        }

        var notification = new
        {
            date,
            shiftKey,
            log
        };

        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(notification), Encoding.UTF8, "application/json")
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

