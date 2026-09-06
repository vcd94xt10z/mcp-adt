Função SADT_REST_RFC_ENDPOINT

Colocar enhancement no final

ENHANCEMENT 1  ZADT.    "active version
  DATA:
  lv_logid         TYPE zadt_log-logid,
  lv_json_request  TYPE string,
  lv_json_response TYPE string,
  lv_json          TYPE string,
  ls_log           TYPE zadt_log.

CALL FUNCTION 'NUMBER_GET_NEXT'
  EXPORTING
    nr_range_nr = '01'
    object      = 'ZADTLOG'
    quantity    = '1'
  IMPORTING
    number      = lv_logid
  EXCEPTIONS
    interval_not_found      = 1
    number_range_not_intern = 2
    object_not_found        = 3
    quantity_is_0           = 4
    quantity_is_not_1       = 5
    interval_overflow       = 6
    buffer_overflow         = 7
    OTHERS                  = 8.

IF sy-subrc = 0.

  lv_json_request = /ui2/cl_json=>serialize(
    data     = request
    compress = abap_true
  ).

  lv_json_response = /ui2/cl_json=>serialize(
    data     = response
    compress = abap_true
  ).

  lv_json = '{"REQUEST":#REQUEST#,"RESPONSE":#RESPONSE#}'.

  REPLACE '#REQUEST#'
    IN lv_json
    WITH lv_json_request.

  REPLACE '#RESPONSE#'
    IN lv_json
    WITH lv_json_response.

  ls_log-logid = lv_logid.
  ls_log-json  = lv_json.

  INSERT zadt_log FROM ls_log.

ENDIF.
ENDENHANCEMENT.