/* Generates deterministic entropy fixtures with upstream Zstandard v1.5.7. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define FSE_STATIC_LINKING_ONLY
#include "common/fse.h"
#include "common/huf.h"

static uint32_t rng = 0x12345678;
static uint32_t random32(void) {
    rng ^= rng << 13;
    rng ^= rng >> 17;
    rng ^= rng << 5;
    return rng;
}

static size_t checked(size_t result) {
    if (FSE_isError(result)) {
        fprintf(stderr, "%s\n", FSE_getErrorName(result));
        exit(1);
    }
    return result;
}

static void hex(const unsigned char* data, size_t size) {
    putchar('"');
    for (size_t i = 0; i < size; i++) printf("%02x", data[i]);
    putchar('"');
}

int main(int argc, char** argv) {
    const unsigned cases = argc > 1 ? (unsigned)atoi(argv[1]) : 12;
    uint64_t workspace[16384];
    printf("{\"source\":\"Zstandard v1.5.7\",\"huffman\":[");
    for (unsigned trial = 0; trial < cases; trial++) {
        unsigned char input[2048], header[1024], one[4096], four[4096], decoded[2048];
        unsigned count[256] = {0};
        unsigned maxSymbol = 0;
        size_t size = 512 + random32() % 1024;
        for (size_t i = 0; i < size; i++) {
            unsigned symbol;
            switch (trial % 6) {
                case 0: symbol = random32() % 6; break;
                case 1: symbol = random32() % 256; break;
                case 2: symbol = random32() % 8 ? 0 : 255; break;
                case 3: symbol = random32() % 4 ? random32() % 3 : random32() % 128; break;
                case 4: symbol = random32() % 16 * 16; break;
                default: symbol = random32() % 10 ? 97 : random32() % 256; break;
            }
            input[i] = (unsigned char)symbol;
            count[symbol]++;
            if (symbol > maxSymbol) maxSymbol = symbol;
        }
        HUF_CREATE_STATIC_CTABLE(ct, 255);
        unsigned log = (unsigned)checked(HUF_buildCTable_wksp(ct, count, maxSymbol, 11, workspace, sizeof(workspace)));
        size_t headerSize = checked(HUF_writeCTable_wksp(header, sizeof(header), ct, maxSymbol, log, workspace, sizeof(workspace)));
        size_t oneSize = checked(HUF_compress1X_usingCTable(one, sizeof(one), input, size, ct, 0));
        size_t fourSize = checked(HUF_compress4X_usingCTable(four, sizeof(four), input, size, ct, 0));
        if (!oneSize || !fourSize) return 2;
        HUF_CREATE_STATIC_DTABLEX1(dt, 12);
        checked(HUF_readDTableX1_wksp(dt, header, headerSize, workspace, sizeof(workspace), 0));
        checked(HUF_decompress1X_usingDTable(decoded, size, one, oneSize, dt, 0));
        if (memcmp(input, decoded, size)) return 3;
        checked(HUF_decompress4X_usingDTable(decoded, size, four, fourSize, dt, 0));
        if (memcmp(input, decoded, size)) return 4;
        if (trial) putchar(',');
        printf("{\"header\":"); hex(header, headerSize);
        printf(",\"one\":"); hex(one, oneSize);
        printf(",\"four\":"); hex(four, fourSize);
        printf(",\"decoded\":"); hex(input, size);
        printf("}");
    }
    printf("],\"fse\":[");
    for (unsigned trial = 0; trial < cases; trial++) {
        short counts[256] = {0};
        unsigned log = 5 + trial % 5;
        unsigned size = 1U << log;
        unsigned alphabet = 2 + random32() % 255;
        unsigned maxSymbol = 0;
        for (unsigned i = 0; i < size; i++) counts[random32() % alphabet]++;
        for (unsigned i = 0; i < alphabet; i++) {
            if (counts[i] == 1 && random32() % 2) counts[i] = -1;
            if (counts[i]) maxSymbol = i;
        }
        unsigned char header[1024];
        size_t headerSize = checked(FSE_writeNCount(header, sizeof(header), counts, maxSymbol, log));
        FSE_DTable dt[FSE_DTABLE_SIZE_U32(9)];
        checked(FSE_buildDTable_wksp(dt, counts, maxSymbol, log, workspace, sizeof(workspace)));
        const FSE_decode_t* rows = (const FSE_decode_t*)(dt + 1);
        if (trial) putchar(',');
        printf("{\"header\":"); hex(header, headerSize);
        printf(",\"tableLog\":%u,\"counts\":[", log);
        for (unsigned i = 0; i <= maxSymbol; i++) printf("%s%d", i ? "," : "", counts[i]);
        printf("],\"symbols\":[");
        for (unsigned i = 0; i < size; i++) printf("%s%u", i ? "," : "", rows[i].symbol);
        printf("],\"bits\":[");
        for (unsigned i = 0; i < size; i++) printf("%s%u", i ? "," : "", rows[i].nbBits);
        printf("],\"base\":[");
        for (unsigned i = 0; i < size; i++) printf("%s%u", i ? "," : "", rows[i].newState);
        printf("]}");
    }
    puts("]}");
    return 0;
}
